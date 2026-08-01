export type TradingMode = 'paper' | 'live';

export type TradierConfig = {
  mode: TradingMode;
  accessToken: string;
  accountId: string;
  baseUrl: string;
};

const LIVE_BASE_URL = 'https://api.tradier.com/v1';
const PAPER_BASE_URL = 'https://sandbox.tradier.com/v1';

export const DEFAULT_PAPER_PORTFOLIO_ID =
  'a8c3cd4c-3c66-4af2-b8bb-1d343399a2f4';
export const DEFAULT_LIVE_PORTFOLIO_ID =
  '5a9db3b0-8942-4c41-9d59-77c3ad2e7a07';

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

export function resolveModeFromArgv(
  argv: string[] = process.argv
): TradingMode {
  const flag = argv.find((arg) => arg.startsWith('--mode='));
  if (flag) {
    return resolveTradingMode(flag.slice('--mode='.length));
  }
  const idx = argv.indexOf('--mode');
  if (idx >= 0 && argv[idx + 1]) {
    return resolveTradingMode(argv[idx + 1]);
  }
  return resolveTradingMode(process.env.TRADING_MODE);
}

export function getSignalSigmaPortfolioId(
  mode: TradingMode,
  env: NodeJS.ProcessEnv = process.env
): string {
  const specific =
    mode === 'live'
      ? env.SIGNAL_SIGMA_LIVE_PORTFOLIO_ID
      : env.SIGNAL_SIGMA_PAPER_PORTFOLIO_ID;
  const fallback = env.SIGNAL_SIGMA_PORTFOLIO_ID;
  const defaults =
    mode === 'live' ? DEFAULT_LIVE_PORTFOLIO_ID : DEFAULT_PAPER_PORTFOLIO_ID;
  const portfolioId = (specific || fallback || defaults).trim();
  if (!portfolioId) {
    throw new Error(
      `Missing Signal Sigma portfolio id for ${mode}. Set SIGNAL_SIGMA_${mode.toUpperCase()}_PORTFOLIO_ID`
    );
  }
  return portfolioId;
}

export function getTradierConfig(
  env: NodeJS.ProcessEnv = process.env,
  modeOverride?: TradingMode
): TradierConfig {
  const mode = modeOverride ?? resolveTradingMode(env.TRADING_MODE);

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

export function requireTradierEnv(mode?: TradingMode): {
  mode: TradingMode;
  tradierAccessToken: string;
  tradierAccountId: string;
  baseUrl: string;
} {
  const config = getTradierConfig(process.env, mode);
  return {
    mode: config.mode,
    tradierAccessToken: config.accessToken,
    tradierAccountId: config.accountId,
    baseUrl: config.baseUrl,
  };
}
