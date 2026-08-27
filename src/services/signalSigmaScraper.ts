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
    let rebalanceClicks = 0;

    for (let attempt = 1; attempt <= 15; attempt++) {
      if (await this.isInAdjustmentStep(page)) {
        console.log('  Rebalance adjustment UI ready (Next visible)');
        return;
      }

      if (await this.isGateOpen(page)) {
        await this.handleOpenGate(page);
        continue;
      }

      const rebalanceBtn = page
        .getByRole('button', { name: /rebalance portfolio/i })
        .filter({ visible: true });
      if ((await this.isVisible(rebalanceBtn, 1000)) && rebalanceClicks < 2) {
        rebalanceClicks += 1;
        console.log(`  Click Rebalance Portfolio (attempt ${rebalanceClicks})...`);
        await rebalanceBtn.first().click({ timeout: 10000 });
        const opened = await this.waitForGateOrAdjustment(page, 20000);
        await this.logGateDebug(page);
        if (!opened) {
          console.warn('  No gate dialog after Rebalance click');
          await this.saveDebugScreenshot(page, `rebalance-click-${rebalanceClicks}`);
          continue;
        }
        await this.handleOpenGate(page);
        continue;
      }

      await page.waitForTimeout(1000);
    }

    const labels = await this.visibleButtonLabels(page);
    await this.saveDebugScreenshot(page, 'enter-rebalance-mode');
    throw new Error(
      `Failed to enter rebalance mode. Visible buttons: ${labels.join(', ') || '(none)'}`
    );
  }

  private visibleDialogs(page: Page): Locator {
    return page.getByRole('dialog').filter({ visible: true });
  }

  private async isGateOpen(page: Page): Promise<boolean> {
    if (await this.isVisible(this.visibleDialogs(page), 250)) {
      return true;
    }
    if (
      await this.isVisible(
        page.getByRole('button', { name: /^(continue|discard|include)$/i }),
        250
      )
    ) {
      return true;
    }
    return this.isVisible(
      page.getByText(
        /sync confirmation|rebalancing will sync|linked items|open orders/i
      ),
      250
    );
  }

  private async waitForGateOrAdjustment(
    page: Page,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isInAdjustmentStep(page)) {
        return true;
      }
      if (await this.isGateOpen(page)) {
        return true;
      }
      await page.waitForTimeout(250);
    }
    return false;
  }

  private async logGateDebug(page: Page): Promise<void> {
    const total = await page.getByRole('dialog').count().catch(() => 0);
    const visible = await this.visibleDialogs(page).count().catch(() => 0);
    const continues = await page
      .getByRole('button', { name: /continue/i })
      .count()
      .catch(() => 0);
    console.log(
      `  Gate debug: dialogs=${total} visible=${visible} continueButtons=${continues}`
    );
  }

  private async handleOpenGate(page: Page): Promise<void> {
    for (let step = 0; step < 8; step++) {
      if (await this.isInAdjustmentStep(page)) {
        return;
      }

      const dialog = this.visibleDialogs(page).last();
      if (await this.isVisible(dialog, 1500)) {
        const dialogText = (
          (await dialog.innerText().catch(() => '')) || ''
        ).toLowerCase();
        console.log(
          `  Dialog open: ${dialogText.slice(0, 160).replace(/\s+/g, ' ')}...`
        );

        if (
          dialogText.includes('open orders') ||
          (await this.isVisible(
            dialog.getByRole('button', { name: /^include$/i }),
            500
          ))
        ) {
          console.log('  Open-orders dialog — discarding existing orders...');
          await this.clickDialogButton(
            page,
            dialog.getByRole('button', { name: /^discard$/i }),
            'Discard'
          );
          await this.waitForAdjustmentOrTimeout(page, 45000);
          continue;
        }

        const continueInDialog = dialog.getByRole('button', {
          name: /continue/i,
        });
        if (await this.isVisible(continueInDialog, 1000)) {
          await this.clickDialogButton(page, continueInDialog, 'Continue');
          continue;
        }

        const discardInDialog = dialog.getByRole('button', {
          name: /^discard$/i,
        });
        if (await this.isVisible(discardInDialog, 1000)) {
          await this.clickDialogButton(page, discardInDialog, 'Discard');
          await this.waitForAdjustmentOrTimeout(page, 20000);
          continue;
        }

        console.warn('  Unrecognized gate dialog; leaving it open');
        return;
      }

      const continueBtn = page
        .getByRole('button', { name: /continue/i })
        .filter({ visible: true });
      if (await this.isVisible(continueBtn, 800)) {
        console.log('  Continue...');
        await this.clickDialogButton(page, continueBtn, 'Continue');
        continue;
      }

      return;
    }
  }

  private async clickDialogButton(
    page: Page,
    button: Locator,
    label: string
  ): Promise<void> {
    console.log(`  Dialog ${label}...`);
    const target = button.filter({ visible: true }).first();
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await target.click({ timeout: 10000 });
    } catch {
      await target.click({ force: true, timeout: 10000 });
    }

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await this.isInAdjustmentStep(page)) {
        return;
      }
      if (!(await target.isVisible().catch(() => false))) {
        await page.waitForTimeout(800);
        return;
      }
      await page.waitForTimeout(250);
    }

    if (await target.isVisible().catch(() => false)) {
      console.log(`  Dialog still open after ${label}; retrying with force click`);
      await target.click({ force: true, timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
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
      await locator
        .filter({ visible: true })
        .first()
        .waitFor({ state: 'visible', timeout });
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
