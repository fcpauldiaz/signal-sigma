export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export {
  requireTradierEnv,
  getTradierConfig,
  getSignalSigmaPortfolioId,
  resolveTradingMode,
  resolveModeFromArgv,
} from './tradierConfig';
export type { TradingMode, TradierConfig } from './tradierConfig';
