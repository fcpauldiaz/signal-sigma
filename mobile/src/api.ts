import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

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
  }>;
  signalPositions: Array<{
    symbol: string;
    name: string;
    amount: number;
    targetAmount: number;
    lastPrice: number;
    ownershipPrice: number;
    strategy: string | null;
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

const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ??
  "https://signal-sigma.chapilabs.com"
).replace(/\/$/, "");

const TOKEN_KEY = "signal_sigma_token";
const MODE_KEY = "signal_sigma_mode";

let _authToken: string | null = null;
let _tradingMode: TradingMode = "paper";

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function storageSet(key: string, value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (value) globalThis.localStorage.setItem(key, value);
      else globalThis.localStorage.removeItem(key);
    } catch {
      /* ignore quota / private mode */
    }
    return;
  }
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

export async function hydrateSession(): Promise<{
  token: string | null;
  mode: TradingMode;
}> {
  const token = await storageGet(TOKEN_KEY);
  const modeRaw = await storageGet(MODE_KEY);
  const mode: TradingMode = modeRaw === "live" ? "live" : "paper";
  _authToken = token;
  _tradingMode = mode;
  return { token, mode };
}

export function getAuthToken(): string | null {
  return _authToken;
}

export function setAuthToken(token: string | null): void {
  _authToken = token;
  void storageSet(TOKEN_KEY, token);
}

export function getTradingMode(): TradingMode {
  return _tradingMode;
}

export function setTradingMode(mode: TradingMode): void {
  _tradingMode = mode;
  void storageSet(MODE_KEY, mode);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Trading-Mode": _tradingMode,
  };
  if (_authToken) headers.Authorization = `Bearer ${_authToken}`;
  return headers;
}

function withMode(path: string): string {
  const url = new URL(path, API_URL);
  url.searchParams.set("mode", _tradingMode);
  return url.toString();
}

async function parseError(r: Response): Promise<string> {
  if (r.status === 401) {
    setAuthToken(null);
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  return data.error || r.statusText;
}

export async function fetchAuthStatus(
  token: string | null
): Promise<AuthStatus> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API_URL}/api/auth/status`, { headers });
  if (!r.ok) throw new Error(r.statusText);
  return r.json() as Promise<AuthStatus>;
}

export async function login(password: string): Promise<{ token: string }> {
  const r = await fetch(`${API_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<{ token: string }>;
}

export async function logout(token: string): Promise<void> {
  await fetch(`${API_URL}/api/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchStatus(): Promise<StatusResponse> {
  const r = await fetch(withMode("/api/status"), { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<StatusResponse>;
}

export async function fetchOrders(): Promise<OrdersResponse> {
  const r = await fetch(withMode("/api/orders"), { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<OrdersResponse>;
}

export async function fetchPositions(): Promise<PositionsResponse> {
  const r = await fetch(withMode("/api/positions"), { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<PositionsResponse>;
}

export async function fetchPerformance(): Promise<PerformanceResponse> {
  const r = await fetch(withMode("/api/performance"), {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<PerformanceResponse>;
}

export async function updateExecution(patch: {
  paper?: boolean;
  live?: boolean;
}): Promise<{ execution: { paper: boolean; live: boolean } }> {
  const r = await fetch(`${API_URL}/api/execution`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<{ execution: { paper: boolean; live: boolean } }>;
}

export async function runRebalance(): Promise<{ job: JobState }> {
  const r = await fetch(withMode("/api/rebalance"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mode: _tradingMode }),
  });
  const data = (await r.json()) as { error?: string; job?: JobState };
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data as { job: JobState };
}

export async function runPlaceOrders(): Promise<{ job: JobState }> {
  const r = await fetch(withMode("/api/place-orders"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mode: _tradingMode }),
  });
  const data = (await r.json()) as { error?: string; job?: JobState };
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data as { job: JobState };
}

export async function runRebalanceAndPlace(): Promise<{ job: JobState }> {
  const r = await fetch(withMode("/api/rebalance-and-place"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mode: _tradingMode }),
  });
  const data = (await r.json()) as { error?: string; job?: JobState };
  if (!r.ok) throw new Error(data.error || data.job?.message || r.statusText);
  return data as { job: JobState };
}

export async function registerPushToken(token: string): Promise<void> {
  const r = await fetch(`${API_URL}/api/push-token`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw new Error(await parseError(r));
}
