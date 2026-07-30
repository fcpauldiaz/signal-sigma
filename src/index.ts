import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { TradierApi } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';
import { requireEnv, requireTradierEnv } from './utils/requireEnv';

dotenv.config();

async function main() {
  const signalSigmaPortfolioId = requireEnv('SIGNAL_SIGMA_PORTFOLIO_ID');
  const { tradierAccessToken, tradierAccountId } = requireTradierEnv();

  console.log('Initializing services...');
  const auth = SignalSigmaAuth.fromEnv();
  const signalSigmaApi = new SignalSigmaApi(auth);
  const tradierApi = new TradierApi(tradierAccessToken, tradierAccountId);

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
