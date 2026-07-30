import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { TradierApi } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';
import { requireEnv } from './utils/requireEnv';

dotenv.config();

async function main() {
  const signalSigmaPortfolioId = requireEnv('SIGNAL_SIGMA_PORTFOLIO_ID');

  console.log('Initializing order placement...');
  const auth = SignalSigmaAuth.fromEnv();
  const tradierApi = TradierApi.fromEnv();

  console.log(`Tradier mode: ${tradierApi.mode} (${tradierApi.accountId})`);
  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  const signalSigmaApi = new SignalSigmaApi(auth);

  const result = await executeOpenOrders({
    signalSigmaApi,
    tradierApi,
    portfolioId: signalSigmaPortfolioId,
  });

  console.log(
    `\n✓ Order placement completed. placed=${result.placedCount} skipped=${result.skippedCount} failed=${result.failedCount} confirmed=${result.confirmedCount}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
