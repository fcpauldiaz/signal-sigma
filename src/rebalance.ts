import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaScraper } from './services/signalSigmaScraper';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { TradierApi } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';
import { requireEnv } from './utils/requireEnv';

dotenv.config();

async function main() {
  const signalSigmaPortfolioId = requireEnv('SIGNAL_SIGMA_PORTFOLIO_ID');

  console.log('Initializing rebalancing...');
  const auth = SignalSigmaAuth.fromEnv();
  const tradierApi = TradierApi.fromEnv();

  console.log(`Tradier mode: ${tradierApi.mode} (${tradierApi.accountId})`);
  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  console.log('Starting rebalancing process...');
  const scraper = new SignalSigmaScraper(auth, signalSigmaPortfolioId);
  const result = await scraper.triggerRebalancing();

  if (!result.success) {
    console.error(`\n✗ Rebalancing failed: ${result.error || 'Unknown error'}`);
    process.exit(1);
  }

  console.log('\n✓ Rebalancing completed successfully');
  console.log('Waiting for backend to update open orders...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const signalSigmaApi = new SignalSigmaApi(auth);

  const execution = await executeOpenOrders({
    signalSigmaApi,
    tradierApi,
    portfolioId: signalSigmaPortfolioId,
  });

  console.log(
    `\n✓ Rebalancing and order placement completed. placed=${execution.placedCount} skipped=${execution.skippedCount} failed=${execution.failedCount} confirmed=${execution.confirmedCount}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
