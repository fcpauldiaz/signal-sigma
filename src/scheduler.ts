import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { UnifiedScheduler } from './services/scheduler';
import { requireEnv, requireTradierEnv } from './utils/requireEnv';

dotenv.config();

async function main() {
  const signalSigmaPortfolioId = requireEnv('SIGNAL_SIGMA_PORTFOLIO_ID');
  const { tradierAccessToken, tradierAccountId } = requireTradierEnv();
  const enableScheduler = process.env.ENABLE_SCHEDULER === 'true';

  // Wednesday 10:00 AM EDT ≈ 14:00 UTC
  const rebalanceSchedule = process.env.REBALANCE_SCHEDULE || '0 14 * * 3';
  // Wednesday hourly 10:00 AM–4:00 PM EDT ≈ 14:00–20:00 UTC
  const orderSchedule = process.env.ORDER_SCHEDULE || '0 14-20 * * 3';

  if (!enableScheduler) {
    console.log('Scheduler is disabled. Set ENABLE_SCHEDULER=true to enable.');
    process.exit(0);
  }

  console.log('Initializing scheduler...');
  const auth = SignalSigmaAuth.fromEnv();

  console.log('Authenticating with Signal Sigma...');
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  const scheduler = new UnifiedScheduler(
    auth,
    signalSigmaPortfolioId,
    tradierAccessToken,
    tradierAccountId,
    rebalanceSchedule,
    orderSchedule
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
