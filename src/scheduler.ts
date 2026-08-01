import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { UnifiedScheduler } from './services/scheduler';
import {
  getSignalSigmaPortfolioId,
  getTradierConfig,
  resolveModeFromArgv,
} from './utils/tradierConfig';

dotenv.config();

async function main() {
  const mode = resolveModeFromArgv();
  const signalSigmaPortfolioId = getSignalSigmaPortfolioId(mode);
  const tradier = getTradierConfig(process.env, mode);
  const enableScheduler = process.env.ENABLE_SCHEDULER === 'true';

  const rebalanceSchedule = process.env.REBALANCE_SCHEDULE || '0 14 * * 3';
  const orderSchedule = process.env.ORDER_SCHEDULE || '0 14-20 * * 3';

  if (!enableScheduler) {
    console.log('Scheduler is disabled. Set ENABLE_SCHEDULER=true to enable.');
    process.exit(0);
  }

  console.log('Initializing scheduler...');
  console.log(`Tradier mode: ${tradier.mode} (${tradier.accountId})`);
  console.log(`Signal Sigma portfolio: ${signalSigmaPortfolioId}`);
  const auth = SignalSigmaAuth.fromEnv();

  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  const scheduler = new UnifiedScheduler(
    auth,
    signalSigmaPortfolioId,
    rebalanceSchedule,
    orderSchedule,
    mode
  );

  scheduler.start();

  console.log('Scheduler is running. Press Ctrl+C to stop.');

  process.on('SIGINT', () => {
    console.log('\nStopping scheduler...');
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nStopping scheduler...');
    scheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
