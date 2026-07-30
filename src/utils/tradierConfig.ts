export type TradingMode = 'paper' | 'live';

export type TradierConfig = {
  mode: TradingMode;
  accessToken: string;
  accountId: string;
  baseUrl: string;
};

const LIVE_BASE_URL = 'https://api.tradier.com/v1';
const PAPER_BASE_URL = 'https://sandbox.tradier.com/v1';

export function resolveTradingMode(
  raw: string | undefined = process.env.TRADING_MODE
): TradingMode {
  const mode = (raw || 'paper').trim().toLowerCase();
  if (mode === 'live' || mode === 'paper') {
    return mode;
  }
  throw new Error(
    `Invalid TRADING_MODE "${raw}". Expected "paper" or "live".`
  );
}

export function getTradierConfig(
  env: NodeJS.ProcessEnv = process.env
): TradierConfig {
  const mode = resolveTradingMode(env.TRADING_MODE);

  if (mode === 'live') {
    const accessToken =
      env.TRADIER_LIVE_API_KEY || env.TRADIER_ACCESS_TOKEN || '';
    const accountId =
      env.TRADIER_LIVE_ACCOUNT_ID || env.TRADIER_ACCOUNT_ID || '';
    if (!accessToken || !accountId) {
      throw new Error(
        'Live mode requires TRADIER_LIVE_API_KEY and TRADIER_LIVE_ACCOUNT_ID'
      );
    }
    return {
      mode,
      accessToken,
      accountId,
      baseUrl: LIVE_BASE_URL,
    };
  }

  const accessToken =
    env.TRADIER_PAPER_API_KEY || env.TRADIER_ACCESS_TOKEN || '';
  const accountId =
    env.TRADIER_PAPER_ACCOUNT_ID || env.TRADIER_ACCOUNT_ID || '';
  if (!accessToken || !accountId) {
    throw new Error(
      'Paper mode requires TRADIER_PAPER_API_KEY and TRADIER_PAPER_ACCOUNT_ID'
    );
  }

  return {
    mode,
    accessToken,
    accountId,
    baseUrl: PAPER_BASE_URL,
  };
}

export function requireTradierEnv(): {
  mode: TradingMode;
  tradierAccessToken: string;
  tradierAccountId: string;
  baseUrl: string;
} {
  const config = getTradierConfig();
  return {
    mode: config.mode,
    tradierAccessToken: config.accessToken,
    tradierAccountId: config.accountId,
    baseUrl: config.baseUrl,
  };
}
