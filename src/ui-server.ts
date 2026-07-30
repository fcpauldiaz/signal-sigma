import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import axios from 'axios';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { SignalSigmaScraper } from './services/signalSigmaScraper';
import { TradierApi, resolveQuotePrice } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';

const UI_PORT = parseInt(process.env.UI_PORT || '3000', 10);
const UI_DIST = path.join(__dirname, '..', 'ui', 'dist');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || '';
const activeSessions = new Set<string>();

type JobKind = 'rebalance' | 'place-orders' | 'rebalance-and-place';

type JobState = {
  kind: JobKind;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt?: string;
  message?: string;
  result?: unknown;
};

let currentJob: JobState | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function extractBearerToken(req: http.IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

function isAuthenticated(req: http.IncomingMessage): boolean {
  if (!ADMIN_PASSWORD) return true;
  const token = extractBearerToken(req);
  return token != null && activeSessions.has(token);
}

function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (isAuthenticated(req)) return true;
  sendJson(res, 401, { error: 'Authentication required' });
  return false;
}

function serveStatic(
  res: http.ServerResponse,
  filePath: string,
  contentType: string
): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function createServices() {
  const portfolioId = process.env.SIGNAL_SIGMA_PORTFOLIO_ID;
  const tradierAccessToken = process.env.TRADIER_ACCESS_TOKEN;
  const tradierAccountId = process.env.TRADIER_ACCOUNT_ID;

  if (!portfolioId) {
    throw new Error('SIGNAL_SIGMA_PORTFOLIO_ID is required');
  }
  if (!tradierAccessToken || !tradierAccountId) {
    throw new Error('TRADIER_ACCESS_TOKEN and TRADIER_ACCOUNT_ID are required');
  }

  const auth = SignalSigmaAuth.fromEnv();
  const signalSigmaApi = new SignalSigmaApi(auth);
  const tradierApi = new TradierApi(tradierAccessToken, tradierAccountId);

  return { auth, signalSigmaApi, tradierApi, portfolioId, tradierAccessToken, tradierAccountId };
}

async function checkTradier(
  accessToken: string,
  accountId: string
): Promise<{
  ok: boolean;
  message: string;
  accountId: string;
  totalEquity?: number | null;
}> {
  try {
    const profile = await axios.get('https://api.tradier.com/v1/user/profile', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const accountsRaw = profile.data?.profile?.account;
    const accounts = !accountsRaw
      ? []
      : Array.isArray(accountsRaw)
        ? accountsRaw
        : [accountsRaw];
    const match = accounts.some(
      (a: { account_number?: string }) => a.account_number === accountId
    );

    let totalEquity: number | null = null;
    try {
      const bal = await axios.get(
        `https://api.tradier.com/v1/accounts/${accountId}/balances`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      totalEquity =
        typeof bal.data?.balances?.total_equity === 'number'
          ? bal.data.balances.total_equity
          : null;
    } catch {
      totalEquity = null;
    }

    return {
      ok: true,
      message: match ? 'connected' : 'token ok, account id not in profile',
      accountId,
      totalEquity,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        ok: false,
        message: `${error.response?.status ?? 'error'} ${error.response?.statusText ?? error.message}`,
        accountId,
        totalEquity: null,
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      accountId,
      totalEquity: null,
    };
  }
}

async function buildStatus() {
  const { auth, signalSigmaApi, portfolioId, tradierAccessToken, tradierAccountId } =
    createServices();

  let signalSigma: {
    ok: boolean;
    message: string;
    portfolio?: { id: string; title: string; tickerCount: number };
  };

  try {
    await auth.ensureAuthenticated();
    const portfolios = await signalSigmaApi.getPortfolios();
    const portfolio = portfolios.portfolios.find((p) => p.id === portfolioId);
    signalSigma = {
      ok: true,
      message: 'connected',
      portfolio: portfolio
        ? {
            id: portfolio.id,
            title: portfolio.title,
            tickerCount: portfolio.tickers.length,
          }
        : undefined,
    };
  } catch (error) {
    signalSigma = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const tradier = await checkTradier(tradierAccessToken, tradierAccountId);

  return {
    signalSigma,
    tradier,
    schedules: {
      rebalance: process.env.REBALANCE_SCHEDULE || '0 14 * * 3',
      orders: process.env.ORDER_SCHEDULE || '0 14-20 * * 3',
      schedulerEnabled: process.env.ENABLE_SCHEDULER === 'true',
    },
    job: currentJob,
  };
}

async function buildOrders() {
  const { auth, signalSigmaApi, tradierApi, portfolioId } = createServices();
  await auth.ensureAuthenticated();
  const { orders } = await signalSigmaApi.getOpenOrders(portfolioId);
  const pending = orders.filter((o) => o.status === 'PENDING');
  const buySymbols = pending
    .filter((o) => o.direction === 'BUY')
    .map((o) => o.symbol);

  let quotesOk = true;
  let quotesMessage = 'ok';
  let quotes = new Map<string, { last: number | null; bid: number | null; ask: number | null; symbol: string }>();

  try {
    quotes = await tradierApi.getQuotes(buySymbols);
  } catch (error) {
    quotesOk = false;
    quotesMessage = error instanceof Error ? error.message : String(error);
  }

  const enriched = pending.map((order) => {
    const marketPrice =
      order.direction === 'BUY'
        ? resolveQuotePrice(quotes.get(order.symbol.toUpperCase()))
        : null;
    const eligible =
      order.direction === 'SELL'
        ? true
        : marketPrice !== null && marketPrice <= order.price;

    return {
      ...order,
      marketPrice,
      eligible,
      skipReason:
        order.direction === 'BUY' && !eligible
          ? marketPrice === null
            ? quotesOk
              ? 'no quote'
              : 'quotes unavailable'
            : `market ${marketPrice} > signal ${order.price}`
          : null,
    };
  });

  return {
    orders: enriched,
    pendingCount: pending.length,
    eligibleCount: enriched.filter((o) => o.eligible).length,
    quotesOk,
    quotesMessage,
  };
}

async function buildPortfolio() {
  const { auth, signalSigmaApi, portfolioId } = createServices();
  await auth.ensureAuthenticated();
  const portfolios = await signalSigmaApi.getPortfolios();
  const portfolio = portfolios.portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }
  return {
    id: portfolio.id,
    title: portfolio.title,
    displayCurrency: portfolio.displayCurrency,
    tickers: portfolio.tickers.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      amount: t.amount,
      targetAmount: t.targetAmount,
      lastPrice: t.lastPrice,
      value: t.value,
      percent: t.percent,
    })),
  };
}

async function runJob(kind: JobKind): Promise<JobState> {
  if (currentJob?.status === 'running') {
    throw new Error(`Job already running: ${currentJob.kind}`);
  }

  currentJob = {
    kind,
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  try {
    const { auth, signalSigmaApi, tradierApi, portfolioId } = createServices();
    await auth.ensureAuthenticated();

    if (kind === 'rebalance' || kind === 'rebalance-and-place') {
      const scraper = new SignalSigmaScraper(auth, portfolioId);
      const result = await scraper.triggerRebalancing();
      if (!result.success) {
        throw new Error(result.error || 'Rebalancing failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    let executionResult: unknown = null;
    if (kind === 'place-orders' || kind === 'rebalance-and-place') {
      executionResult = await executeOpenOrders({
        signalSigmaApi,
        tradierApi,
        portfolioId,
      });
    }

    currentJob = {
      ...currentJob,
      status: 'success',
      finishedAt: new Date().toISOString(),
      message: 'completed',
      result: executionResult,
    };
    return currentJob;
  } catch (error) {
    currentJob = {
      ...currentJob!,
      status: 'error',
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
    return currentJob;
  }
}

export function startUiServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/auth/status' && req.method === 'GET') {
        sendJson(res, 200, {
          authEnabled: Boolean(ADMIN_PASSWORD),
          authenticated: isAuthenticated(req),
        });
        return;
      }

      if (pathname === '/api/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const password = String(body.password || '');
        if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
          sendJson(res, 401, { error: 'Invalid password' });
          return;
        }
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.add(token);
        sendJson(res, 200, { token });
        return;
      }

      if (pathname === '/api/logout' && req.method === 'POST') {
        const token = extractBearerToken(req);
        if (token) activeSessions.delete(token);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname.startsWith('/api/') && !requireAuth(req, res)) {
        return;
      }

      if (pathname === '/api/status' && req.method === 'GET') {
        sendJson(res, 200, await buildStatus());
        return;
      }

      if (pathname === '/api/orders' && req.method === 'GET') {
        sendJson(res, 200, await buildOrders());
        return;
      }

      if (pathname === '/api/portfolio' && req.method === 'GET') {
        sendJson(res, 200, await buildPortfolio());
        return;
      }

      if (pathname === '/api/job' && req.method === 'GET') {
        sendJson(res, 200, { job: currentJob });
        return;
      }

      if (pathname === '/api/rebalance' && req.method === 'POST') {
        const job = await runJob('rebalance');
        sendJson(res, job.status === 'success' ? 200 : 500, { job });
        return;
      }

      if (pathname === '/api/place-orders' && req.method === 'POST') {
        const job = await runJob('place-orders');
        sendJson(res, job.status === 'success' ? 200 : 500, { job });
        return;
      }

      if (pathname === '/api/rebalance-and-place' && req.method === 'POST') {
        const job = await runJob('rebalance-and-place');
        sendJson(res, job.status === 'success' ? 200 : 500, { job });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      const requestPath = pathname === '/' ? '/index.html' : pathname;
      const filePath = path.join(UI_DIST, requestPath);
      if (!filePath.startsWith(UI_DIST)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        serveStatic(res, filePath, MIME[ext] || 'application/octet-stream');
        return;
      }

      const indexPath = path.join(UI_DIST, 'index.html');
      if (fs.existsSync(indexPath)) {
        serveStatic(res, indexPath, 'text/html');
        return;
      }

      res.writeHead(404);
      res.end(
        'UI not built. Run: cd ui && pnpm install && pnpm run build'
      );
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(UI_PORT, () => {
    console.log(`Signal Sigma UI listening on http://localhost:${UI_PORT}`);
  });

  return server;
}
