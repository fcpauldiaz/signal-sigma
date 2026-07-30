import dotenv from 'dotenv';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';

dotenv.config();

async function main() {
  console.log('Authenticating with Signal Sigma...');
  const auth = SignalSigmaAuth.fromEnv();
  await auth.ensureAuthenticated();
  console.log('Authentication successful');

  const api = new SignalSigmaApi(auth);
  const portfolios = await api.getPortfolios();
  console.log(`Fetched ${portfolios.portfolios.length} portfolio(s):`);
  for (const portfolio of portfolios.portfolios) {
    console.log(`  - ${portfolio.title} (${portfolio.id}) [${portfolio.tickers.length} tickers]`);
  }
}

main().catch((error) => {
  console.error('Auth check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
