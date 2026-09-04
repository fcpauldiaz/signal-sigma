import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { TradierApi } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';
import {
  getSignalSigmaPortfolioId,
  resolveModeFromArgv,
} from './utils/tradierConfig';
import { notifyDeskJob, notifyOrders } from './utils/deskNotify';
import { isExecutionEnabled } from './utils/executionSettings';

dotenv.config();

async function main() {
  const mode = resolveModeFromArgv();
  if (!isExecutionEnabled(mode)) {
    console.log(`${mode} order execution is disabled — skipping.`);
    process.exit(0);
  }
  const signalSigmaPortfolioId = getSignalSigmaPortfolioId(mode);

  console.log('Initializing order placement...');
  const auth = SignalSigmaAuth.fromEnv();
  const tradierApi = TradierApi.forMode(mode);

  console.log(`Tradier mode: ${tradierApi.mode} (${tradierApi.accountId})`);
  console.log(`Signal Sigma portfolio: ${signalSigmaPortfolioId}`);
  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  const signalSigmaApi = new SignalSigmaApi(auth);

  const result = await executeOpenOrders({
    signalSigmaApi,
    tradierApi,
    portfolioId: signalSigmaPortfolioId,
    mode,
  });

  console.log(
    `\n✓ Order placement completed. placed=${result.placedCount} skipped=${result.skippedCount} failed=${result.failedCount} confirmed=${result.confirmedCount}`
  );
  await notifyOrders(mode, result, { onlyIfActivity: true });
  process.exit(0);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Fatal error:', error);
  await notifyDeskJob({
    kind: 'place-orders',
    mode: resolveModeFromArgv(),
    status: 'error',
    message,
  });
  process.exit(1);
});
