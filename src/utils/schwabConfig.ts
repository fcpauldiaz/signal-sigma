const AUTH_BASE = 'https://api.schwabapi.com/v1/oauth';
const TRADER_BASE = 'https://api.schwabapi.com/trader/v1';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SchwabConfig = {
  appKey: string;
  appSecret: string;
  callbackUrl: string;
  accountHash: string | null;
  accountNumber: string | null;
};

export function getSchwabAuthBaseUrl(): string {
  return AUTH_BASE;
}

export function getSchwabTraderBaseUrl(): string {
  return TRADER_BASE;
}

export function getSchwabRefreshTokenTtlMs(): number {
  return REFRESH_TOKEN_TTL_MS;
}

export function getSchwabConfig(
  env: NodeJS.ProcessEnv = process.env
): SchwabConfig | null {
  const appKey = (env.SCHWAB_APP_KEY || env.SCHWAB_CLIENT_ID || '').trim();
  const appSecret = (
    env.SCHWAB_APP_SECRET ||
    env.SCHWAB_CLIENT_SECRET ||
    ''
  ).trim();
  if (!appKey || !appSecret) {
    return null;
  }

  const port = env.UI_PORT?.trim() || '3000';
  const callbackUrl = (
    env.SCHWAB_CALLBACK_URL ||
    `https://127.0.0.1:${port}/api/schwab/callback`
  ).trim();

  const accountHash = (env.SCHWAB_ACCOUNT_HASH || '').trim() || null;
  const accountNumber = (env.SCHWAB_ACCOUNT_NUMBER || '').trim() || null;

  return { appKey, appSecret, callbackUrl, accountHash, accountNumber };
}

export function isSchwabConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return getSchwabConfig(env) !== null;
}
