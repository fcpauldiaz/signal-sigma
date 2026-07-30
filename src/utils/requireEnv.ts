export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function requireTradierEnv(): {
  tradierAccessToken: string;
  tradierAccountId: string;
} {
  return {
    tradierAccessToken: requireEnv('TRADIER_ACCESS_TOKEN'),
    tradierAccountId: requireEnv('TRADIER_ACCOUNT_ID'),
  };
}
