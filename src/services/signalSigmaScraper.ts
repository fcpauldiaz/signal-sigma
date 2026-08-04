import fs from 'fs';
import path from 'path';
import { chromium, Browser, BrowserContext, Locator, Page } from 'playwright';
import { SignalSigmaAuth } from './signalSigmaAuth';

export interface RebalanceResult {
  success: boolean;
  error?: string;
  step?: string;
}

/**
 * Signal Sigma rebalance UI flow (from live frontend):
 * 1. Dismiss unfinished draft banner if present
 * 2. Click "Rebalance Portfolio"
 * 3. Gate dialogs:
 *    - Sync links → Continue | Link Setup
 *    - Existing open orders → Discard | Include  (weekly runs Discard)
 *    - Auto cash holdings → Continue
 * 4. Adjustment → Next
 * 5. Comparison → Set as Target
 * 6. Summary → Done
 */
export class SignalSigmaScraper {
  private auth: SignalSigmaAuth;
  private portfolioId: string;
  private baseUrl: string;

  constructor(auth: SignalSigmaAuth, portfolioId: string) {
    this.auth = auth;
    this.portfolioId = portfolioId;
    this.baseUrl = 'https://live.signal-sigma.com';
  }

  async triggerRebalancing(): Promise<RebalanceResult> {
    let browser: Browser | null = null;

    try {
      console.log('Launching browser...');
      const headless = process.env.HEADLESS !== 'false';
      browser = await chromium.launch({ headless });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });

      const accessToken = await this.auth.getAccessToken();
      const refreshToken = this.auth.getRefreshToken();
      console.log('Injecting authentication token...');
      await this.injectToken(context, accessToken);

      const page = await context.newPage();
      const portfolioUrl = `${this.baseUrl}/portfolio/${this.portfolioId}`;
      console.log(`Navigating to ${portfolioUrl}...`);

      await page.goto(portfolioUrl, { waitUntil: 'domcontentloaded' });
      await this.injectTokenInPage(page, accessToken, refreshToken);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByRole('button', { name: /rebalance portfolio/i })
        .waitFor({ state: 'visible', timeout: 45000 });

      console.log('Executing rebalancing sequence...');
      await this.dismissDraftBanner(page);
      await this.enterRebalanceMode(page);
      await this.clickNamedButton(page, /^next$/i, 'Step 3: Next');
      await this.clickNamedButton(page, /set as target/i, 'Step 4: Set as target');
      await this.clickNamedButton(page, /^done$/i, 'Step 5: Done');

      console.log('Rebalancing sequence completed successfully');
      await browser.close();
      return { success: true };
    } catch (error) {
      if (browser) {
        await browser.close().catch(() => undefined);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Rebalancing failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async dismissDraftBanner(page: Page): Promise<void> {
    const draftText = page.getByText(/unfinished rebalancing draft/i);
    if (!(await this.isVisible(draftText, 2000))) {
      return;
    }

    console.log('  Dismissing unfinished rebalancing draft...');
    const discard = page.getByRole('button', { name: /^discard$/i });
    if (await this.isVisible(discard, 2000)) {
      await discard.click();
      await page.waitForTimeout(2000);
    }
  }

  private async enterRebalanceMode(page: Page): Promise<void> {
    console.log('  Step 1–2: Enter rebalance mode...');

    for (let attempt = 1; attempt <= 6; attempt++) {
      if (await this.isInAdjustmentStep(page)) {
        console.log('  Rebalance adjustment UI ready (Next visible)');
        return;
      }

      const rebalanceBtn = page.getByRole('button', {
        name: /rebalance portfolio/i,
      });
      if (await this.isVisible(rebalanceBtn, 2000)) {
        console.log(`  Click Rebalance Portfolio (attempt ${attempt})...`);
        await rebalanceBtn.click({ timeout: 10000 });
        await page.waitForTimeout(1500);
      }

      await this.handleOpenGate(page);

      if (await this.isInAdjustmentStep(page)) {
        console.log('  Rebalance adjustment UI ready (Next visible)');
        return;
      }

      await page.waitForTimeout(1500);
    }

    const labels = await this.visibleButtonLabels(page);
    await this.saveDebugScreenshot(page, 'enter-rebalance-mode');
    throw new Error(
      `Failed to enter rebalance mode. Visible buttons: ${labels.join(', ') || '(none)'}`
    );
  }

  private async handleOpenGate(page: Page): Promise<void> {
    const dialog = page.getByRole('dialog');

    if (await this.isVisible(dialog, 2500)) {
      const dialogText = ((await dialog.innerText().catch(() => '')) || '').toLowerCase();
      console.log(`  Dialog open: ${dialogText.slice(0, 120).replace(/\s+/g, ' ')}...`);

      // Open orders gate → Discard (clears old orders, then enters rebalance).
      if (
        dialogText.includes('open orders') ||
        (await this.isVisible(dialog.getByRole('button', { name: /^include$/i }), 500))
      ) {
        console.log('  Open-orders dialog — discarding existing orders...');
        await dialog.getByRole('button', { name: /^discard$/i }).click({ timeout: 15000 });
        // resetPortfolioOrders + refetch can take a few seconds before Next appears.
        await this.waitForAdjustmentOrTimeout(page, 20000);
        return;
      }

      // Sync links / cash holdings / generic continue.
      const continueInDialog = dialog.getByRole('button', { name: /^continue$/i });
      if (await this.isVisible(continueInDialog, 1000)) {
        console.log('  Dialog Continue...');
        await continueInDialog.click({ timeout: 10000 });
        await page.waitForTimeout(2000);
        return;
      }

      const discardInDialog = dialog.getByRole('button', { name: /^discard$/i });
      if (await this.isVisible(discardInDialog, 1000)) {
        console.log('  Dialog Discard...');
        await discardInDialog.click({ timeout: 10000 });
        await this.waitForAdjustmentOrTimeout(page, 15000);
        return;
      }
    }

    // Non-dialog Continue (cash holdings modal sometimes lacks dialog role).
    const continueBtn = page.getByRole('button', { name: /^continue$/i });
    if (await this.isVisible(continueBtn, 1000)) {
      console.log('  Continue...');
      await continueBtn.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
    }
  }

  private async waitForAdjustmentOrTimeout(
    page: Page,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isInAdjustmentStep(page)) {
        return;
      }
      await page.waitForTimeout(500);
    }
  }

  private async isInAdjustmentStep(page: Page): Promise<boolean> {
    const next = page.getByRole('button', { name: /^next$/i });
    const cancel = page.getByRole('button', { name: /^cancel$/i });
    return (
      (await this.isVisible(next, 400)) && (await this.isVisible(cancel, 400))
    );
  }

  private async clickNamedButton(
    page: Page,
    name: RegExp,
    stepName: string
  ): Promise<void> {
    console.log(`  ${stepName}...`);
    const button = page.getByRole('button', { name }).first();

    try {
      await button.waitFor({ state: 'visible', timeout: 30000 });
      await button.scrollIntoViewIfNeeded();
      await button.click({ timeout: 10000 });
      await page.waitForTimeout(1500);
      return;
    } catch {
      const labels = await this.visibleButtonLabels(page);
      await this.saveDebugScreenshot(page, stepName);
      throw new Error(
        `Failed to find or click button matching ${name}. Step: ${stepName}. Visible: ${labels.join(', ') || '(none)'}`
      );
    }
  }

  private async isVisible(locator: Locator, timeout = 1500): Promise<boolean> {
    try {
      await locator.first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  private async visibleButtonLabels(page: Page): Promise<string[]> {
    try {
      return await page.locator('button:visible').evaluateAll((buttons) =>
        buttons
          .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 25)
      );
    } catch {
      return [];
    }
  }

  private async saveDebugScreenshot(page: Page, stepName: string): Promise<void> {
    try {
      const dir = path.resolve(process.cwd(), 'data');
      fs.mkdirSync(dir, { recursive: true });
      const safe = stepName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const filePath = path.join(dir, `rebalance-fail-${safe}-${Date.now()}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.warn(`  Saved debug screenshot: ${filePath}`);
    } catch {
      // ignore screenshot failures
    }
  }

  private async injectToken(
    context: BrowserContext,
    accessToken: string
  ): Promise<void> {
    const cookieNames = [
      'accessToken',
      'token',
      'authToken',
      'access_token',
      'auth_token',
    ];

    for (const cookieName of cookieNames) {
      try {
        await context.addCookies([
          {
            name: cookieName,
            value: accessToken,
            domain: '.signal-sigma.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax',
          },
        ]);
        console.log(`  Set cookie: ${cookieName}`);
      } catch {
        continue;
      }
    }

    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${accessToken}`,
    });
    console.log('  Set Authorization header');
  }

  private async injectTokenInPage(
    page: Page,
    accessToken: string,
    refreshToken: string
  ): Promise<void> {
    try {
      await page.evaluate(
        ({
          accessToken,
          refreshToken,
        }: {
          accessToken: string;
          refreshToken: string;
        }) => {
          const win = globalThis as unknown as {
            localStorage?: {
              setItem(key: string, value: string): void;
            };
          };

          if (win.localStorage) {
            const persistAuth = {
              accessToken: JSON.stringify(accessToken),
              refreshToken: JSON.stringify(refreshToken),
              otpToken: JSON.stringify(''),
              redirectTo: JSON.stringify(''),
              _persist: JSON.stringify({ version: -1, rehydrated: true }),
            };

            win.localStorage.setItem(
              'persist:auth',
              JSON.stringify(persistAuth)
            );
          }
        },
        { accessToken, refreshToken }
      );
      console.log('  Injected persist:auth into localStorage');
    } catch (error) {
      console.warn('  Failed to inject token into page storage:', error);
    }
  }
}
