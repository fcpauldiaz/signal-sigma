export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
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
    mode?: "paper" | "live";
    totalEquity?: number | null;
  };
  tradingMode?: "paper" | "live";
  schedules: {
    rebalance: string;
    orders: string;
    schedulerEnabled: boolean;
  };
  job: JobState | null;
}

export interface JobState {
  kind: string;
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

export interface OpenOrderRow {
  id: string;
  symbol: string;
  name: string;
  amount: number;
  price: number;
  value: number;
  direction: "BUY" | "SELL";
  status: string;
  date: string;
  marketPrice: number | null;
  eligible: boolean;
  skipReason: string | null;
}

export interface OrdersResponse {
  orders: OpenOrderRow[];
  pendingCount: number;
  eligibleCount: number;
  quotesOk: boolean;
  quotesMessage: string;
}

export interface PortfolioResponse {
  id: string;
  title: string;
  displayCurrency: string;
  tickers: Array<{
    symbol: string;
    name: string;
    amount: number;
    targetAmount: number;
    lastPrice: number;
    value: number;
    percent: number;
  }>;
}

let _authToken: string | null = localStorage.getItem("signal_sigma_token");

export function getAuthToken(): string | null {
  return _authToken;
}

export function setAuthToken(token: string | null): void {
  _authToken = token;
  if (token) localStorage.setItem("signal_sigma_token", token);
  else localStorage.removeItem("signal_sigma_token");
}

function authHeaders(): Record<string, string> {
  return _authToken ? { Authorization: `Bearer ${_authToken}` } : {};
}

async function parseError(r: Response): Promise<string> {
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  return data.error || r.statusText;
}

export async function fetchAuthStatus(token: string | null): Promise<AuthStatus> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch("/api/auth/status", { headers });
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

export async function login(password: string): Promise<{ token: string }> {
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function logout(token: string): Promise<void> {
  await fetch("/api/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchStatus(): Promise<StatusResponse> {
  const r = await fetch("/api/status", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchOrders(): Promise<OrdersResponse> {
  const r = await fetch("/api/orders", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const r = await fetch("/api/portfolio", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function runRebalance(): Promise<{ job: JobState }> {
  const r = await fetch("/api/rebalance", {
    method: "POST",
    headers: authHeaders(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data;
}

export async function runPlaceOrders(): Promise<{ job: JobState }> {
  const r = await fetch("/api/place-orders", {
    method: "POST",
    headers: authHeaders(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data;
}

export async function runRebalanceAndPlace(): Promise<{ job: JobState }> {
  const r = await fetch("/api/rebalance-and-place", {
    method: "POST",
    headers: authHeaders(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data;
}
