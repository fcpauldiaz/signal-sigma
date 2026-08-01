import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaScraper } from './services/signalSigmaScraper';
import {
  getSignalSigmaPortfolioId,
  resolveModeFromArgv,
} from './utils/tradierConfig';

dotenv.config();

async function main() {
  const mode = resolveModeFromArgv();
  const signalSigmaPortfolioId = getSignalSigmaPortfolioId(mode);

  console.log('Initializing rebalancing...');
  console.log(`Mode: ${mode}`);
  console.log(`Signal Sigma portfolio: ${signalSigmaPortfolioId}`);
  const auth = SignalSigmaAuth.fromEnv();

  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  console.log('Starting rebalancing process...');
  const scraper = new SignalSigmaScraper(auth, signalSigmaPortfolioId);
  const result = await scraper.triggerRebalancing();

  if (result.success) {
    console.log('\n✓ Rebalancing completed successfully');
    process.exit(0);
  } else {
    console.error(`\n✗ Rebalancing failed: ${result.error || 'Unknown error'}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
