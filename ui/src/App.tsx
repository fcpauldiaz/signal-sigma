import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAuthStatus,
  fetchOrders,
  fetchPortfolio,
  fetchStatus,
  getAuthToken,
  login,
  logout,
  runPlaceOrders,
  runRebalance,
  runRebalanceAndPlace,
  setAuthToken,
  type OpenOrderRow,
  type StatusResponse,
} from "./api";

type Route = "dashboard" | "orders" | "portfolio";

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path.startsWith("orders")) return "orders";
  if (path.startsWith("portfolio")) return "portfolio";
  return "dashboard";
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function LoginModal({
  open,
  onClose,
  onLoggedIn,
}: {
  open: boolean;
  onClose: () => void;
  onLoggedIn: () => void;
}) {
  const [password, setPassword] = useState("");
  const mut = useMutation({
    mutationFn: () => login(password),
    onSuccess: (data) => {
      setAuthToken(data.token);
      onLoggedIn();
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Admin login</h2>
        <p>Enter the dashboard password to run actions.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate();
          }}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          <div className="portfolio-actions" style={{ marginTop: 12 }}>
            <button type="submit" disabled={mut.isPending || !password}>
              {mut.isPending ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
          {mut.isError && <p className="error-msg">{String(mut.error)}</p>}
        </form>
      </div>
    </div>
  );
}

function Nav({
  route,
  authEnabled,
  authenticated,
  onLogin,
  onLogout,
}: {
  route: Route;
  authEnabled: boolean;
  authenticated: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <nav className="app-nav">
      <a href="#/dashboard" className="app-nav-brand">
        Signal Sigma
      </a>
      <a href="#/dashboard" className={route === "dashboard" ? "active" : ""}>
        Dashboard
      </a>
      <a href="#/orders" className={route === "orders" ? "active" : ""}>
        Open Orders
      </a>
      <a href="#/portfolio" className={route === "portfolio" ? "active" : ""}>
        Portfolio
      </a>
      {authEnabled && (
        <div className="nav-auth">
          {authenticated ? (
            <button type="button" className="nav-auth-btn" onClick={onLogout}>
              Log out
            </button>
          ) : (
            <button type="button" className="nav-auth-btn" onClick={onLogin}>
              Log in
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

function StatusPills({ status }: { status: StatusResponse }) {
  return (
    <section className="stats-section">
      <ul className="stats-list">
        <li>
          Signal Sigma:{" "}
          <span className={`status ${status.signalSigma.ok ? "connected" : "disconnected"}`}>
            {status.signalSigma.ok ? "connected" : "error"}
          </span>
        </li>
        <li>
          Tradier:{" "}
          <span className={`status ${status.tradier.ok ? "connected" : "disconnected"}`}>
            {status.tradier.ok ? "connected" : "error"}
          </span>
        </li>
        <li>Rebalance cron: <code>{status.schedules.rebalance}</code></li>
        <li>Orders cron: <code>{status.schedules.orders}</code></li>
        <li>
          Scheduler:{" "}
          <span
            className={`status ${status.schedules.schedulerEnabled ? "connected" : "disconnected"}`}
          >
            {status.schedules.schedulerEnabled ? "enabled" : "disabled"}
          </span>
        </li>
      </ul>
    </section>
  );
}

function JobBanner({ status }: { status: StatusResponse }) {
  const job = status.job;
  if (!job) return null;
  return (
    <div className="portfolio-row" style={{ marginBottom: 16 }}>
      <div className="portfolio-row-header">
        <div className="portfolio-row-main">
          <span className="portfolio-name">Last job: {job.kind}</span>
          <span className={`status ${job.status === "success" ? "connected" : job.status === "running" ? "disconnected" : "disconnected"}`}>
            {job.status}
          </span>
        </div>
      </div>
      <p className="portfolio-last-run">
        started {new Date(job.startedAt).toLocaleString()}
        {job.finishedAt ? ` · finished ${new Date(job.finishedAt).toLocaleString()}` : ""}
        {job.message ? ` · ${job.message}` : ""}
      </p>
      {job.result && (
        <p className="verify-msg">
          placed={job.result.placedCount ?? 0} skipped={job.result.skippedCount ?? 0}{" "}
          failed={job.result.failedCount ?? 0} confirmed={job.result.confirmedCount ?? 0}
        </p>
      )}
    </div>
  );
}

function ActionButtons({
  disabled,
}: {
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["status"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  };

  const rebalance = useMutation({
    mutationFn: runRebalance,
    onSettled: invalidate,
  });
  const place = useMutation({
    mutationFn: runPlaceOrders,
    onSettled: invalidate,
  });
  const both = useMutation({
    mutationFn: runRebalanceAndPlace,
    onSettled: invalidate,
  });

  const busy = rebalance.isPending || place.isPending || both.isPending;

  return (
    <div className="portfolio-actions" style={{ marginBottom: 24 }}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => rebalance.mutate()}
      >
        {rebalance.isPending ? "Rebalancing…" : "Rebalance"}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => place.mutate()}
      >
        {place.isPending ? "Placing…" : "Place eligible orders"}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => both.mutate()}
      >
        {both.isPending ? "Running…" : "Rebalance + place"}
      </button>
      {(rebalance.isError || place.isError || both.isError) && (
        <p className="error-msg">
          {String(rebalance.error || place.error || both.error)}
        </p>
      )}
    </div>
  );
}

function DashboardView({
  status,
  canAct,
}: {
  status: StatusResponse;
  canAct: boolean;
}) {
  const portfolio = status.signalSigma.portfolio;
  return (
    <>
      <h1>Dashboard</h1>
      <p>
        Wednesday rebalance for TradierV2, then place Signal Sigma open orders on
        Tradier. Buys only when market ≤ signal price.
      </p>
      <StatusPills status={status} />
      <JobBanner status={status} />
      <ActionButtons disabled={!canAct} />
      <div className="portfolio-row">
        <div className="portfolio-row-header">
          <div className="portfolio-row-main">
            <span className="portfolio-name">
              {portfolio?.title ?? "Portfolio not found"}
            </span>
            {portfolio && (
              <span className="portfolio-current-value">
                {portfolio.tickerCount} tickers
              </span>
            )}
          </div>
          <span
            className={`status ${status.signalSigma.ok ? "connected" : "disconnected"}`}
          >
            {status.signalSigma.ok ? "live" : "offline"}
          </span>
        </div>
        <p className="verify-msg">{portfolio?.id}</p>
        <p className="portfolio-last-run">
          Tradier {status.tradier.accountId}
          {status.tradier.totalEquity != null
            ? ` · equity ${money(status.tradier.totalEquity)}`
            : ""}
          {" · "}
          {status.tradier.message}
        </p>
        {!status.signalSigma.ok && (
          <p className="error-msg">{status.signalSigma.message}</p>
        )}
        {!status.tradier.ok && (
          <p className="error-msg">Tradier: {status.tradier.message}</p>
        )}
      </div>
    </>
  );
}

function OrdersTable({ orders }: { orders: OpenOrderRow[] }) {
  if (orders.length === 0) {
    return <p>No pending open orders.</p>;
  }

  return (
    <div className="positions-table-wrap">
      <table className="positions-table">
        <thead>
          <tr>
            <th>Side</th>
            <th>Qty</th>
            <th>Symbol</th>
            <th>Signal</th>
            <th>Market</th>
            <th>Value</th>
            <th>Gate</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className={o.direction === "BUY" ? "pos" : "neg"}>{o.direction}</td>
              <td>{o.amount}</td>
              <td>
                <strong>{o.symbol}</strong>
              </td>
              <td>{money(o.price)}</td>
              <td>{money(o.marketPrice)}</td>
              <td>{money(o.value)}</td>
              <td>
                <span className={`status ${o.eligible ? "connected" : "disconnected"}`}>
                  {o.eligible ? "eligible" : o.skipReason || "skip"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersView({ canAct }: { canAct: boolean }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["orders"],
    queryFn: fetchOrders,
  });

  return (
    <>
      <h1>Open Orders</h1>
      <p>Pending Signal Sigma orders with Tradier price gate for buys.</p>
      <ActionButtons disabled={!canAct} />
      <div className="portfolio-actions" style={{ marginBottom: 16 }}>
        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {isLoading && <p>Loading orders…</p>}
      {error && <p className="error-msg">{String(error)}</p>}
      {data && (
        <>
          <section className="stats-section">
            <ul className="stats-list">
              <li>Pending: {data.pendingCount}</li>
              <li>Eligible now: {data.eligibleCount}</li>
              <li>
                Quotes:{" "}
                <span className={`status ${data.quotesOk ? "connected" : "disconnected"}`}>
                  {data.quotesOk ? "ok" : "unavailable"}
                </span>
              </li>
            </ul>
          </section>
          {!data.quotesOk && (
            <p className="error-msg">Quotes: {data.quotesMessage}</p>
          )}
          <OrdersTable orders={data.orders} />
        </>
      )}
    </>
  );
}

function PortfolioView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  const totalValue = useMemo(
    () => data?.tickers.reduce((sum, t) => sum + (t.value || 0), 0) ?? 0,
    [data]
  );

  return (
    <>
      <h1>Portfolio</h1>
      <p>Current Signal Sigma holdings vs targets for the tracked portfolio.</p>
      {isLoading && <p>Loading portfolio…</p>}
      {error && <p className="error-msg">{String(error)}</p>}
      {data && (
        <>
          <div className="portfolio-row">
            <div className="portfolio-row-header">
              <div className="portfolio-row-main">
                <span className="portfolio-name">{data.title}</span>
                <span className="portfolio-current-value">{money(totalValue)}</span>
              </div>
            </div>
            <p className="verify-msg">
              {data.tickers.length} tickers · {data.displayCurrency}
            </p>
          </div>
          <div className="positions-table-wrap">
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Shares</th>
                  <th>Target</th>
                  <th>Price</th>
                  <th>Value</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {data.tickers
                  .slice()
                  .sort((a, b) => b.value - a.value)
                  .map((t) => (
                    <tr key={t.symbol}>
                      <td>
                        <strong>{t.symbol}</strong>
                      </td>
                      <td>{t.amount}</td>
                      <td>{t.targetAmount}</td>
                      <td>{money(t.lastPrice)}</td>
                      <td>{money(t.value)}</td>
                      <td>{(t.percent * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function App() {
  const route = useHashRoute();
  const [loginOpen, setLoginOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: ["auth", token],
    queryFn: () => fetchAuthStatus(token),
  });

  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    enabled: !authQuery.data?.authEnabled || Boolean(authQuery.data?.authenticated),
    refetchInterval: 30_000,
  });

  const authEnabled = authQuery.data?.authEnabled ?? false;
  const authenticated = authQuery.data?.authenticated ?? !authEnabled;
  const canAct = !authEnabled || authenticated;

  return (
    <>
      <Nav
        route={route}
        authEnabled={authEnabled}
        authenticated={authenticated}
        onLogin={() => setLoginOpen(true)}
        onLogout={async () => {
          if (token) await logout(token);
          setAuthToken(null);
          setToken(null);
          queryClient.clear();
        }}
      />

      {authEnabled && !authenticated && (
        <div className="portfolio-row">
          <h1>Sign in required</h1>
          <p>Log in to view portfolio data and run rebalance / order actions.</p>
          <button type="button" onClick={() => setLoginOpen(true)}>
            Log in
          </button>
        </div>
      )}

      {canAct && statusQuery.isLoading && <p>Loading…</p>}
      {canAct && statusQuery.error && (
        <p className="error-msg">{String(statusQuery.error)}</p>
      )}

      {canAct && statusQuery.data && route === "dashboard" && (
        <DashboardView status={statusQuery.data} canAct={canAct} />
      )}
      {canAct && route === "orders" && <OrdersView canAct={canAct} />}
      {canAct && route === "portfolio" && <PortfolioView />}

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLoggedIn={() => {
          setToken(getAuthToken());
          queryClient.invalidateQueries();
        }}
      />
    </>
  );
}
