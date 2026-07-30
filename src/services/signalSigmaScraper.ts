import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { SignalSigmaAuth } from './signalSigmaAuth';

export interface RebalanceResult {
  success: boolean;
  error?: string;
  step?: string;
}

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
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      console.log('Launching browser...');
      const headless = process.env.HEADLESS !== 'false';
      browser = await chromium.launch({ headless });
      context = await browser.newContext();

      const accessToken = await this.auth.getAccessToken();
      const refreshToken = this.auth.getRefreshToken();
      console.log('Injecting authentication token...');

      await this.injectToken(context, accessToken);

      page = await context.newPage();
      const portfolioUrl = `${this.baseUrl}/portfolio/${this.portfolioId}`;
      console.log(`Navigating to ${portfolioUrl}...`);

      await page.goto(portfolioUrl, { waitUntil: 'domcontentloaded' });
      
      await this.injectTokenInPage(page, accessToken, refreshToken);
      
      await page.waitForTimeout(2000);

      console.log('Executing rebalancing sequence...');

      await this.clickButton(page, 'rebalance portfolio', 'Step 1: Rebalance portfolio');
      await this.clickButton(page, 'continue', 'Step 2: Continue');
      await this.clickButton(page, 'next', 'Step 3: Next');
      await this.clickButton(page, 'set as target', 'Step 4: Set as target');
      await this.clickButton(page, 'done', 'Step 5: Done');

      console.log('Rebalancing sequence completed successfully');

      await browser.close();

      return { success: true };
    } catch (error) {
      if (browser) {
        await browser.close();
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Rebalancing failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async injectToken(
    context: BrowserContext,
    accessToken: string
  ): Promise<void> {
    const cookieNames = ['accessToken', 'token', 'authToken', 'access_token', 'auth_token'];
    
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
      } catch (error) {
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
        ({ accessToken, refreshToken }: { accessToken: string; refreshToken: string }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const win = globalThis as any;
          
          if (win.localStorage) {
            const persistAuth = {
              accessToken: JSON.stringify(accessToken),
              refreshToken: JSON.stringify(refreshToken),
              otpToken: JSON.stringify(''),
              redirectTo: JSON.stringify(''),
              _persist: JSON.stringify({ version: -1, rehydrated: true }),
            };
            
            win.localStorage.setItem('persist:auth', JSON.stringify(persistAuth));
          }
        },
        { accessToken, refreshToken }
      );
      console.log('  Injected persist:auth into localStorage');
    } catch (error) {
      console.warn('  Failed to inject token into page storage:', error);
    }
  }

  private async clickButton(
    page: Page,
    buttonText: string,
    stepName: string
  ): Promise<void> {
    console.log(`  ${stepName}...`);

    const normalizedText = buttonText.toLowerCase();
    const selectors = [
      `button:has-text("${buttonText}")`,
      `button:has-text("${buttonText}" i)`,
      `button[aria-label*="${buttonText}" i]`,
      `a:has-text("${buttonText}")`,
      `a:has-text("${buttonText}" i)`,
      `[role="button"]:has-text("${buttonText}")`,
      `[role="button"]:has-text("${buttonText}" i)`,
      `button >> text="${buttonText}"`,
      `button >> text=/.*${normalizedText}.*/i`,
    ];

    let buttonFound = false;
    for (const selector of selectors) {
      try {
        const button = page.locator(selector).first();
        await button.waitFor({ state: 'visible', timeout: 10000 });
        await button.scrollIntoViewIfNeeded();
        await button.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        buttonFound = true;
        break;
      } catch (error) {
        continue;
      }
    }

    if (!buttonFound) {
      throw new Error(
        `Failed to find or click "${buttonText}" button. Step: ${stepName}`
      );
    }
  }
}

