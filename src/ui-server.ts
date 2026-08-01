import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import axios from 'axios';
import { SignalSigmaAuth } from './services/signalSigmaAuth';
import { SignalSigmaApi } from './services/signalSigmaApi';
import { SignalSigmaScraper } from './services/signalSigmaScraper';
import { TradierApi } from './services/tradierApi';
import { executeOpenOrders } from './services/openOrderExecutor';
import {
  getSignalSigmaPortfolioId,
  getTradierConfig,
  resolveTradingMode,
  TradingMode,
} from './utils/tradierConfig';
import {
  buildOwnershipBySymbol,
  evaluateOpenOrder,
  getConfiguredStrategyIds,
} from './utils/openOrderEligibility';
import {
  getExecutionSettings,
  isExecutionEnabled,
  setExecutionSettings,
} from './utils/executionSettings';

const UI_PORT = parseInt(process.env.UI_PORT || '3000', 10);
const UI_DIST = path.join(__dirname, '..', 'ui', 'dist');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || '';
const activeSessions = new Set<string>();

type JobKind = 'rebalance' | 'place-orders' | 'rebalance-and-place';

type JobState = {
  kind: JobKind;
  mode: TradingMode;
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

function createServices(mode: TradingMode) {
  const portfolioId = getSignalSigmaPortfolioId(mode);
  const tradier = getTradierConfig(process.env, mode);
  const auth = SignalSigmaAuth.fromEnv();
  const signalSigmaApi = new SignalSigmaApi(auth);
  const tradierApi = TradierApi.forMode(mode);

  return { auth, signalSigmaApi, tradierApi, portfolioId, tradier, mode };
}

function resolveRequestMode(
  req: http.IncomingMessage,
  url: URL,
  body?: Record<string, unknown>
): TradingMode {
  const fromQuery = url.searchParams.get('mode');
  if (fromQuery) {
    return resolveTradingMode(fromQuery);
  }
  const header = req.headers['x-trading-mode'];
  if (typeof header === 'string' && header.trim()) {
    return resolveTradingMode(header);
  }
  if (body && typeof body.mode === 'string') {
    return resolveTradingMode(body.mode);
  }
  return resolveTradingMode(process.env.TRADING_MODE);
}

function modeSummary() {
  return {
    paper: {
      portfolioId: getSignalSigmaPortfolioId('paper'),
      accountId: getTradierConfig(process.env, 'paper').accountId,
    },
    live: {
      portfolioId: getSignalSigmaPortfolioId('live'),
      accountId: getTradierConfig(process.env, 'live').accountId,
    },
  };
}

async function checkTradier(tradier: {
  mode: TradingMode;
  accessToken: string;
  accountId: string;
  baseUrl: string;
}): Promise<{
  ok: boolean;
  message: string;
  accountId: string;
  mode: TradingMode;
  totalEquity?: number | null;
}> {
  try {
    const profile = await axios.get(`${tradier.baseUrl}/user/profile`, {
      headers: {
        Authorization: `Bearer ${tradier.accessToken}`,
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
      (a: { account_number?: string }) => a.account_number === tradier.accountId
    );

    let totalEquity: number | null = null;
    try {
      const bal = await axios.get(
        `${tradier.baseUrl}/accounts/${tradier.accountId}/balances`,
        {
          headers: {
            Authorization: `Bearer ${tradier.accessToken}`,
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
      accountId: tradier.accountId,
      mode: tradier.mode,
      totalEquity,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        ok: false,
        message: `${error.response?.status ?? 'error'} ${error.response?.statusText ?? error.message}`,
        accountId: tradier.accountId,
        mode: tradier.mode,
        totalEquity: null,
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      accountId: tradier.accountId,
      mode: tradier.mode,
      totalEquity: null,
    };
  }
}

async function buildStatus(mode: TradingMode) {
  const { auth, signalSigmaApi, portfolioId, tradier } = createServices(mode);

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

  const tradierStatus = await checkTradier(tradier);

  return {
    signalSigma,
    tradier: tradierStatus,
    tradingMode: mode,
    modes: modeSummary(),
    execution: getExecutionSettings(),
    schedules: {
      rebalance: process.env.REBALANCE_SCHEDULE || '0 14 * * 3',
      orders: process.env.ORDER_SCHEDULE || '0 14-20 * * 3',
      // Jobs run via Coolify scheduled tasks; in-app node-cron stays off.
      source: 'coolify',
      schedulerEnabled: false,
    },
    job: currentJob,
  };
}

async function buildOrders(mode: TradingMode) {
  const { auth, signalSigmaApi, tradierApi, portfolioId } = createServices(mode);
  await auth.ensureAuthenticated();

  const [{ orders }, portfolios, strategyBooks] = await Promise.all([
    signalSigmaApi.getOpenOrders(portfolioId),
    signalSigmaApi.getPortfolios(),
    signalSigmaApi.getStrategyPositionBooks(getConfiguredStrategyIds()),
  ]);

  const portfolio = portfolios.portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }

  const ownershipBySymbol = buildOwnershipBySymbol(
    portfolio.tickers,
    strategyBooks
  );
  const pending = orders.filter((o) => o.status === 'PENDING');
  const buySymbols = pending
    .filter((o) => o.direction === 'BUY')
    .map((o) => o.symbol);

  let quotesOk = true;
  let quotesMessage = 'ok';
  let quotes = new Map<
    string,
    { last: number | null; bid: number | null; ask: number | null; symbol: string }
  >();

  try {
    quotes = await tradierApi.getQuotes(buySymbols);
  } catch (error) {
    quotesOk = false;
    quotesMessage = error instanceof Error ? error.message : String(error);
  }

  const enriched = pending.map((order) => {
    const decision = evaluateOpenOrder(order, quotes, ownershipBySymbol);
    return {
      ...order,
      strategy: decision.strategy,
      ownershipPrice: decision.ownershipPrice,
      marketPrice: decision.marketPrice,
      eligible: decision.place,
      skipReason: decision.place ? null : decision.reason,
    };
  });

  return {
    mode,
    orders: enriched,
    pendingCount: pending.length,
    eligibleCount: enriched.filter((o) => o.eligible).length,
    quotesOk,
    quotesMessage,
  };
}

async function buildPortfolio(mode: TradingMode) {
  const { auth, signalSigmaApi, portfolioId } = createServices(mode);
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
    mode,
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

async function buildPositions(mode: TradingMode) {
  const { auth, signalSigmaApi, tradierApi, portfolioId, tradier } =
    createServices(mode);
  await auth.ensureAuthenticated();

  const [brokerPositions, balances, portfolios, openOrders, strategyBooks] =
    await Promise.all([
      tradierApi.getPositions(),
      tradierApi.getBalances(),
      signalSigmaApi.getPortfolios(),
      signalSigmaApi.getOpenOrders(portfolioId),
      signalSigmaApi.getStrategyPositionBooks(getConfiguredStrategyIds()),
    ]);

  const portfolio = portfolios.portfolios.find((p) => p.id === portfolioId);
  const signalTickers = portfolio?.tickers ?? [];
  const pendingOrders = openOrders.orders.filter((o) => o.status === 'PENDING');
  const ownershipBySymbol = buildOwnershipBySymbol(signalTickers, strategyBooks);

  return {
    mode: tradier.mode,
    accountId: tradier.accountId,
    portfolioId,
    balances,
    brokerPositions,
    signalPositions: signalTickers.map((t) => {
      const ownership = ownershipBySymbol.get(t.symbol.toUpperCase());
      return {
        symbol: t.symbol,
        name: t.name,
        amount: t.amount,
        targetAmount: t.targetAmount,
        lastPrice: t.lastPrice,
        ownershipPrice: ownership?.ownershipPrice ?? t.ownershipPrice,
        strategy: ownership?.strategy || t.customGroup || null,
        value: t.value,
        percent: t.percent,
      };
    }),
    pendingOrderCount: pendingOrders.length,
    signalPortfolioValue: signalTickers.reduce((sum, t) => sum + (t.value || 0), 0),
  };
}

async function buildPerformance(mode: TradingMode) {
  const { tradierApi, tradier } = createServices(mode);
  const [closed, balances] = await Promise.all([
    tradierApi.getGainLoss(100),
    tradierApi.getBalances(),
  ]);

  const sorted = closed
    .slice()
    .sort((a, b) => a.closeDate.localeCompare(b.closeDate));

  const monthlyMap = new Map<string, number>();
  let cumulative = 0;
  const cumulativeSeries: Array<{ date: string; cumulative: number; gainLoss: number }> =
    [];

  for (const trade of sorted) {
    const month = trade.closeDate.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + trade.gainLoss);
    cumulative += trade.gainLoss;
    cumulativeSeries.push({
      date: trade.closeDate.slice(0, 10),
      cumulative,
      gainLoss: trade.gainLoss,
    });
  }

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, gainLoss]) => ({ month, gainLoss }));

  const winners = sorted.filter((t) => t.gainLoss > 0).length;
  const losers = sorted.filter((t) => t.gainLoss < 0).length;

  return {
    mode: tradier.mode,
    accountId: tradier.accountId,
    balances,
    totals: {
      realizedPl: cumulative,
      tradeCount: sorted.length,
      winners,
      losers,
      winRate: sorted.length ? winners / sorted.length : 0,
    },
    monthly,
    cumulativeSeries,
    recentClosed: sorted.slice().reverse().slice(0, 25),
  };
}

async function runJob(kind: JobKind, mode: TradingMode): Promise<JobState> {
  if (currentJob?.status === 'running') {
    throw new Error(`Job already running: ${currentJob.kind} (${currentJob.mode})`);
  }

  currentJob = {
    kind,
    mode,
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  try {
    const { auth, signalSigmaApi, tradierApi, portfolioId } = createServices(mode);
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
      if (!isExecutionEnabled(mode)) {
        if (kind === 'place-orders') {
          throw new Error(
            `${mode} order execution is disabled. Enable it on the desk before placing orders.`
          );
        }
        executionResult = {
          skipped: true,
          reason: `${mode} order execution is disabled`,
        };
      } else {
        executionResult = await executeOpenOrders({
          signalSigmaApi,
          tradierApi,
          portfolioId,
        });
      }
    }

    currentJob = {
      ...currentJob,
      status: 'success',
      finishedAt: new Date().toISOString(),
      message: `completed (${mode})`,
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

      if (pathname === '/api/execution' && req.method === 'GET') {
        sendJson(res, 200, { execution: getExecutionSettings() });
        return;
      }

      if (pathname === '/api/execution' && req.method === 'POST') {
        const body = await parseBody(req);
        const patch: { paper?: boolean; live?: boolean } = {};
        if (typeof body.paper === 'boolean') patch.paper = body.paper;
        if (typeof body.live === 'boolean') patch.live = body.live;
        const execution = setExecutionSettings(patch);
        sendJson(res, 200, { execution });
        return;
      }

      if (pathname === '/api/status' && req.method === 'GET') {
        const mode = resolveRequestMode(req, url);
        sendJson(res, 200, await buildStatus(mode));
        return;
      }

      if (pathname === '/api/orders' && req.method === 'GET') {
        const mode = resolveRequestMode(req, url);
        sendJson(res, 200, await buildOrders(mode));
        return;
      }

      if (pathname === '/api/portfolio' && req.method === 'GET') {
        const mode = resolveRequestMode(req, url);
        sendJson(res, 200, await buildPortfolio(mode));
        return;
      }

      if (pathname === '/api/positions' && req.method === 'GET') {
        const mode = resolveRequestMode(req, url);
        sendJson(res, 200, await buildPositions(mode));
        return;
      }

      if (pathname === '/api/performance' && req.method === 'GET') {
        const mode = resolveRequestMode(req, url);
        sendJson(res, 200, await buildPerformance(mode));
        return;
      }

      if (pathname === '/api/job' && req.method === 'GET') {
        sendJson(res, 200, { job: currentJob });
        return;
      }

      if (pathname === '/api/rebalance' && req.method === 'POST') {
        const body = await parseBody(req);
        const mode = resolveRequestMode(req, url, body);
        const job = await runJob('rebalance', mode);
        sendJson(res, job.status === 'success' ? 200 : 500, { job });
        return;
      }

      if (pathname === '/api/place-orders' && req.method === 'POST') {
        const body = await parseBody(req);
        const mode = resolveRequestMode(req, url, body);
        const job = await runJob('place-orders', mode);
        sendJson(res, job.status === 'success' ? 200 : 500, { job });
        return;
      }

      if (pathname === '/api/rebalance-and-place' && req.method === 'POST') {
        const body = await parseBody(req);
        const mode = resolveRequestMode(req, url, body);
        const job = await runJob('rebalance-and-place', mode);
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
