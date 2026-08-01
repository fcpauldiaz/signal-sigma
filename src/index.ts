import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { TradierApi } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';
import {
  getSignalSigmaPortfolioId,
  resolveModeFromArgv,
} from './utils/tradierConfig';

dotenv.config();

async function main() {
  const mode = resolveModeFromArgv();
  const signalSigmaPortfolioId = getSignalSigmaPortfolioId(mode);

  console.log('Initializing services...');
  const auth = SignalSigmaAuth.fromEnv();
  const signalSigmaApi = new SignalSigmaApi(auth);
  const tradierApi = TradierApi.forMode(mode);

  console.log(`Tradier mode: ${tradierApi.mode} (${tradierApi.accountId})`);
  console.log(`Signal Sigma portfolio: ${signalSigmaPortfolioId}`);
  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  const result = await executeOpenOrders({
    signalSigmaApi,
    tradierApi,
    portfolioId: signalSigmaPortfolioId,
  });

  console.log(
    `\nOrder placement completed. placed=${result.placedCount} skipped=${result.skippedCount} failed=${result.failedCount} confirmed=${result.confirmedCount}`
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
