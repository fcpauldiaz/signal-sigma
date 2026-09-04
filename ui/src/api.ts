export type TradingMode = "paper" | "live";

export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
}

export interface JobState {
  kind: string;
  mode?: TradingMode;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  message?: string;
  result?: {
    pendingCount?: number;
    placedCount?: number;
    skippedCount?: number;
    confirmedCount?: number;
    failedCount?: number;
  };
}

export interface StatusResponse {
  signalSigma: {
    ok: boolean;
    message: string;
    portfolio?: { id: string; title: string; tickerCount: number };
  };
  tradier: {
    ok: boolean;
    message: string;
    accountId: string;
    mode?: TradingMode;
    totalEquity?: number | null;
  };
  tradingMode?: TradingMode;
  modes?: {
    paper: { portfolioId: string; accountId: string };
    live: { portfolioId: string; accountId: string };
  };
  execution?: {
    paper: boolean;
    live: boolean;
  };
  push?: {
    devices: number;
  };
  schwab?: {
    ok: boolean;
    configured: boolean;
    needsReauth: boolean;
    message: string;
    accountId: string | null;
    refreshExpiresAt: string | null;
    totalEquity: number | null;
  };
  schedules: {
    rebalance: string;
    orders: string;
    source: "coolify" | "in-app";
    schedulerEnabled: boolean;
  };
  job: JobState | null;
}

export interface OpenOrderRow {
  id: string;
  symbol: string;
  name: string;
  amount: number;
  quantity: number;
  price: number;
  value: number;
  direction: "BUY" | "SELL";
  status: string;
  date: string;
  strategy: string | null;
  ownershipPrice: number | null;
  marketPrice: number | null;
  eligible: boolean;
  readyOverride?: "auto" | "force" | "block";
  autoEligible?: boolean;
  skipReason: string | null;
}

export interface OrdersResponse {
  mode?: TradingMode;
  orders: OpenOrderRow[];
  pendingCount: number;
  eligibleCount: number;
  quotesOk: boolean;
  quotesMessage: string;
}

export interface PositionsResponse {
  mode: TradingMode;
  accountId: string;
  portfolioId?: string;
  balances: {
    totalEquity: number | null;
    totalCash: number | null;
    marketValue: number | null;
    openPl: number | null;
    closePl: number | null;
    pendingOrdersCount: number | null;
  };
  brokerPositions: Array<{
    symbol: string;
    quantity: number;
    costBasis: number;
    dateAcquired: string | null;
    lastPrice: number | null;
    avgCost: number | null;
    marketValue: number | null;
    openPl: number | null;
    openPlPercent: number | null;
    strategy: string | null;
  }>;
  signalPositions: Array<{
    symbol: string;
    name: string;
    amount: number;
    targetAmount: number;
    lastPrice: number;
    ownershipPrice: number;
    strategy: string | null;
    systemClassification?: string | null;
    value: number;
    percent: number;
  }>;
  pendingOrderCount: number;
  signalPortfolioValue: number;
}

export interface PerformanceResponse {
  mode: TradingMode;
  accountId: string;
  balances: PositionsResponse["balances"];
  totals: {
    realizedPl: number;
    realizedYtd: number;
    tradeCount: number;
    winners: number;
    losers: number;
    winRate: number;
  };
  monthly: Array<{ month: string; gainLoss: number }>;
  cumulativeSeries: Array<{
    date: string;
    cumulative: number;
    gainLoss: number;
    symbol: string;
    quantity: number;
    cost: number;
    proceeds: number;
    gainLossPercent: number;
    openDate: string;
    closeDate: string;
  }>;
  recentClosed: Array<{
    symbol: string;
    quantity: number;
    cost: number;
    proceeds: number;
    gainLoss: number;
    gainLossPercent: number;
    openDate: string;
    closeDate: string;
  }>;
}

export interface SchwabConnection {
  connected: boolean;
  configured: boolean;
  needsReauth: boolean;
  message: string;
  refreshExpiresAt: string | null;
}

export interface SchwabPositionsResponse extends SchwabConnection {
  accountId: string;
  balances: PositionsResponse["balances"];
  brokerPositions: PositionsResponse["brokerPositions"];
}

export interface SchwabPerformanceResponse extends SchwabConnection {
  accountId: string;
  balances: PositionsResponse["balances"];
  historyFrom: string | null;
  historyTo: string | null;
  totals: PerformanceResponse["totals"];
  monthly: PerformanceResponse["monthly"];
  cumulativeSeries: PerformanceResponse["cumulativeSeries"];
  recentClosed: PerformanceResponse["recentClosed"];
}

let _tradingMode: TradingMode =
  (localStorage.getItem("signal_sigma_mode") as TradingMode | null) === "live"
    ? "live"
    : "paper";

export function getTradingMode(): TradingMode {
  return _tradingMode;
}

export function setTradingMode(mode: TradingMode): void {
  _tradingMode = mode;
  localStorage.setItem("signal_sigma_mode", mode);
}

function modeHeaders(): Record<string, string> {
  return { "X-Trading-Mode": _tradingMode };
}

function withMode(path: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("mode", _tradingMode);
  return url.pathname + url.search;
}

async function parseError(r: Response): Promise<string> {
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  return data.error || r.statusText;
}

const cookieFetch: RequestInit = { credentials: "include" };

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const r = await fetch("/api/auth/status", cookieFetch);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

export async function login(password: string): Promise<{ ok: boolean }> {
  const r = await fetch("/api/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", {
    method: "POST",
    credentials: "include",
  });
}

export async function fetchStatus(): Promise<StatusResponse> {
  const r = await fetch(withMode("/api/status"), {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchOrders(): Promise<OrdersResponse> {
  const r = await fetch(withMode("/api/orders"), {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function setOrderReady(
  orderId: string,
  ready: "auto" | "force" | "block"
): Promise<{ orderId: string; mode: TradingMode; readyOverride: string }> {
  const r = await fetch(withMode("/api/orders/ready"), {
    method: "POST",
    credentials: "include",
    headers: { ...modeHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, ready, mode: _tradingMode }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchPositions(): Promise<PositionsResponse> {
  const r = await fetch(withMode("/api/positions"), {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchPerformance(): Promise<PerformanceResponse> {
  const r = await fetch(withMode("/api/performance"), {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchSchwabAuthUrl(): Promise<{
  url: string;
  callbackUrl: string | null;
}> {
  const r = await fetch("/api/schwab/auth/url", {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchSchwabPositions(): Promise<SchwabPositionsResponse> {
  const r = await fetch("/api/schwab/positions", {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchSchwabPerformance(): Promise<SchwabPerformanceResponse> {
  const r = await fetch("/api/schwab/performance", {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchExecution(): Promise<{
  execution: { paper: boolean; live: boolean };
}> {
  const r = await fetch("/api/execution", {
    ...cookieFetch,
    headers: modeHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function updateExecution(patch: {
  paper?: boolean;
  live?: boolean;
}): Promise<{
  execution: { paper: boolean; live: boolean };
  push?: { devices: number; sent: boolean; warning?: string };
}> {
  const r = await fetch("/api/execution", {
    method: "POST",
    credentials: "include",
    headers: { ...modeHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function runRebalance(): Promise<{ job: JobState }> {
  const r = await fetch(withMode("/api/rebalance"), {
    method: "POST",
    credentials: "include",
    headers: { ...modeHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mode: _tradingMode }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data;
}

export async function runPlaceOrders(): Promise<{ job: JobState }> {
  const r = await fetch(withMode("/api/place-orders"), {
    method: "POST",
    credentials: "include",
    headers: { ...modeHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mode: _tradingMode }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data;
}

export async function runRebalanceAndPlace(): Promise<{ job: JobState }> {
  const r = await fetch(withMode("/api/rebalance-and-place"), {
    method: "POST",
    credentials: "include",
    headers: { ...modeHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mode: _tradingMode }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data;
}
