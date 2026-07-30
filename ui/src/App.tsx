import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  fetchAuthStatus,
  fetchOrders,
  fetchPerformance,
  fetchPositions,
  fetchStatus,
  getAuthToken,
  login,
  logout,
  runPlaceOrders,
  runRebalance,
  runRebalanceAndPlace,
  setAuthToken,
  type OpenOrderRow,
  type PerformanceResponse,
  type PositionsResponse,
  type StatusResponse,
} from "./api";

type Route = "overview" | "positions" | "orders" | "performance";

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
  if (path.startsWith("positions")) return "positions";
  if (path.startsWith("orders")) return "orders";
  if (path.startsWith("performance")) return "performance";
  return "overview";
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function plClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "pos" : "neg";
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
        <h2>Unlock desk</h2>
        <p>Password required for trading actions.</p>
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
          {mut.isError && (
            <p className="error-msg">{(mut.error as Error).message}</p>
          )}
          <div className="actions" style={{ marginBottom: 0 }}>
            <button type="submit" disabled={mut.isPending || !password}>
              {mut.isPending ? "…" : "Unlock"}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CumulativeChart({
  series,
}: {
  series: PerformanceResponse["cumulativeSeries"];
}) {
  const w = 640;
  const h = 220;
  const pad = { t: 16, r: 16, b: 28, l: 52 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const points = useMemo(() => {
    if (!series.length) return null;
    const ys = series.map((p) => p.cumulative);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    const span = maxY - minY || 1;
    const coords = series.map((p, i) => {
      const x = pad.l + (i / Math.max(series.length - 1, 1)) * innerW;
      const y = pad.t + ((maxY - p.cumulative) / span) * innerH;
      return { x, y, ...p };
    });
    const zeroY = pad.t + ((maxY - 0) / span) * innerH;
    const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
    const area = `${pad.l},${zeroY} ${line} ${coords[coords.length - 1].x},${zeroY}`;
    return { coords, line, area, zeroY, minY, maxY };
  }, [series, innerH, innerW, pad.l, pad.r, pad.t, pad.b]);

  if (!points) {
    return <p>No closed trades yet.</p>;
  }

  const ticks = [points.minY, 0, points.maxY].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <title>Cumulative realized P&amp;L</title>
        <g className="chart-grid">
          {ticks.map((t) => {
            const span = points.maxY - points.minY || 1;
            const y = pad.t + ((points.maxY - t) / span) * innerH;
            return (
              <g key={t}>
                <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} />
                <text className="chart-axis" x={pad.l - 8} y={y + 3} textAnchor="end">
                  {money(t)}
                </text>
              </g>
            );
          })}
        </g>
        <polygon className="chart-area" points={points.area} />
        <polyline className="chart-line" points={points.line} />
        <text className="chart-axis" x={pad.l} y={h - 6}>
          {series[0]?.date}
        </text>
        <text className="chart-axis" x={w - pad.r} y={h - 6} textAnchor="end">
          {series[series.length - 1]?.date}
        </text>
      </svg>
    </div>
  );
}

function MonthlyBars({ monthly }: { monthly: PerformanceResponse["monthly"] }) {
  const w = 640;
  const h = 200;
  const pad = { t: 12, r: 12, b: 36, l: 52 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  if (!monthly.length) return <p>No monthly P&amp;L yet.</p>;

  const values = monthly.map((m) => m.gainLoss);
  const minY = Math.min(0, ...values);
  const maxY = Math.max(0, ...values);
  const span = maxY - minY || 1;
  const yAt = (v: number) => pad.t + ((maxY - v) / span) * innerH;
  const zeroY = yAt(0);
  const barW = Math.max(6, (innerW / monthly.length) * 0.7);
  const gap = innerW / monthly.length;

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} role="img">
        <title>Monthly realized P&amp;L</title>
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-rule)"
        />
        <text className="chart-axis" x={pad.l - 8} y={yAt(maxY) + 3} textAnchor="end">
          {money(maxY)}
        </text>
        <text className="chart-axis" x={pad.l - 8} y={yAt(minY) + 3} textAnchor="end">
          {money(minY)}
        </text>
        {monthly.map((m, i) => {
          const cx = pad.l + gap * i + gap / 2;
          const yVal = yAt(m.gainLoss);
          const y = Math.min(yVal, zeroY);
          const hBar = Math.max(Math.abs(yVal - zeroY), 1);
          const label =
            i === 0 || i === monthly.length - 1 || monthly.length <= 8
              ? m.month.slice(2)
              : i % Math.ceil(monthly.length / 6) === 0
                ? m.month.slice(5)
                : "";
          return (
            <g key={m.month}>
              <rect
                className={`chart-bar ${m.gainLoss >= 0 ? "pos" : "neg"}`}
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={hBar}
              >
                <title>
                  {m.month}: {money(m.gainLoss)}
                </title>
              </rect>
              {label && (
                <text className="chart-axis" x={cx} y={h - 8} textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "";
}) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className={`metric-value ${tone || ""}`}>{value}</p>
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`status ${ok ? "connected" : "disconnected"}`}>
      {label}
    </span>
  );
}

function OverviewPage({
  status,
  positions,
  performance,
  ordersPending,
}: {
  status: StatusResponse;
  positions?: PositionsResponse;
  performance?: PerformanceResponse;
  ordersPending: number;
}) {
  const equity = positions?.balances.totalEquity ?? status.tradier.totalEquity;
  const openPl = positions?.balances.openPl;
  const realized = performance?.totals.realizedPl;

  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Signal Sigma · desk</p>
        <h1>Overview</h1>
        <p>
          Track equity, open risk, and realized P&amp;L for{" "}
          <code>{status.tradier.accountId || "—"}</code> (
          {status.tradingMode || status.tradier.mode || "—"})
        </p>
      </header>

      <div className="stats-inline">
        <StatusDot ok={status.signalSigma.ok} label="Signal Sigma" />
        <StatusDot ok={status.tradier.ok} label="Tradier" />
        <span>
          Schedules {status.schedules.schedulerEnabled ? "on" : "off"} ·{" "}
          {status.schedules.rebalance} / {status.schedules.orders}
        </span>
      </div>

      <div className="metric-grid">
        <Metric label="Equity" value={money(equity)} />
        <Metric label="Open P&L" value={money(openPl)} tone={plClass(openPl)} />
        <Metric
          label="Realized P&L"
          value={money(realized)}
          tone={plClass(realized)}
        />
        <Metric label="Open orders" value={String(ordersPending)} />
      </div>

      {performance && performance.cumulativeSeries.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Cumulative realized</h2>
            <span className="status connected">
              {performance.totals.tradeCount} closes · win{" "}
              {pct(performance.totals.winRate)}
            </span>
          </div>
          <CumulativeChart series={performance.cumulativeSeries} />
        </section>
      )}

      {status.job && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Last job · {status.job.kind}</h2>
            <span
              className={`status ${
                status.job.status === "success"
                  ? "connected"
                  : status.job.status === "error"
                    ? "warn"
                    : "disconnected"
              }`}
            >
              {status.job.status}
            </span>
          </div>
          <p style={{ margin: 0 }}>
            {status.job.message || "—"}
            {status.job.result && (
              <>
                {" "}
                · placed {status.job.result.placedCount ?? 0} · confirmed{" "}
                {status.job.result.confirmedCount ?? 0} · skipped{" "}
                {status.job.result.skippedCount ?? 0}
              </>
            )}
          </p>
        </section>
      )}
    </>
  );
}

function PositionsPage({ data }: { data: PositionsResponse }) {
  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Broker · Signal Sigma</p>
        <h1>Positions</h1>
        <p>
          Live Tradier holdings vs Signal Sigma target book (
          {data.mode} · {data.accountId})
        </p>
      </header>

      <div className="metric-grid">
        <Metric label="Equity" value={money(data.balances.totalEquity)} />
        <Metric label="Cash" value={money(data.balances.totalCash)} />
        <Metric label="Market value" value={money(data.balances.marketValue)} />
        <Metric
          label="Open P&L"
          value={money(data.balances.openPl)}
          tone={plClass(data.balances.openPl)}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Broker positions</h2>
          <span>{data.brokerPositions.length} symbols</span>
        </div>
        {data.brokerPositions.length === 0 ? (
          <p>No open broker positions (cash).</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Cost basis</th>
                  <th>Acquired</th>
                </tr>
              </thead>
              <tbody>
                {data.brokerPositions.map((p) => (
                  <tr key={p.symbol}>
                    <td>{p.symbol}</td>
                    <td>{p.quantity}</td>
                    <td>{money(p.costBasis)}</td>
                    <td>{p.dateAcquired?.slice(0, 10) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Signal Sigma book</h2>
          <span>
            {data.signalPositions.length} · {money(data.signalPortfolioValue)} ·{" "}
            {data.pendingOrderCount} pending
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Shares</th>
                <th>Target</th>
                <th>Own $</th>
                <th>Last</th>
                <th>Value</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {data.signalPositions.map((t) => (
                <tr key={t.symbol}>
                  <td>{t.symbol}</td>
                  <td>{t.strategy || "—"}</td>
                  <td>{t.amount}</td>
                  <td>{t.targetAmount}</td>
                  <td>{money(t.ownershipPrice)}</td>
                  <td>{money(t.lastPrice)}</td>
                  <td>{money(t.value)}</td>
                  <td>{t.percent?.toFixed?.(1) ?? t.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function OrdersPage({
  orders,
  quotesOk,
  quotesMessage,
}: {
  orders: OpenOrderRow[];
  quotesOk: boolean;
  quotesMessage: string;
}) {
  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Open orders</p>
        <h1>Orders</h1>
        <p>
          Pending Signal Sigma instructions — BUY only when market ≤ strategy
          ownership price (Millennium Alpha / Momentum).
        </p>
      </header>

      <div className="stats-inline">
        <StatusDot ok={quotesOk} label={quotesOk ? "Quotes ok" : "Quotes down"} />
        {!quotesOk && <span className="error-msg">{quotesMessage}</span>}
        <span>
          {orders.filter((o) => o.eligible).length} eligible / {orders.length}{" "}
          pending
        </span>
      </div>

      <div className="table-wrap">
        <table className="data">
            <thead>
              <tr>
                <th>Side</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Qty</th>
                <th>Ownership</th>
                <th>SS price</th>
                <th>Market</th>
                <th>Value</th>
                <th>Ready</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={9}>No pending orders.</td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id}>
                    <td className={o.direction === "BUY" ? "pos" : "neg"}>
                      {o.direction}
                    </td>
                    <td>{o.symbol}</td>
                    <td>{o.strategy || "—"}</td>
                    <td>{o.amount}</td>
                    <td>{money(o.ownershipPrice)}</td>
                    <td>{money(o.price)}</td>
                    <td>{money(o.marketPrice)}</td>
                    <td>{money(o.value)}</td>
                    <td>
                      {o.eligible ? (
                        <span className="status connected">yes</span>
                      ) : (
                        <span className="status warn" title={o.skipReason || ""}>
                          no
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
        </table>
      </div>
    </>
  );
}

function PerformancePage({ data }: { data: PerformanceResponse }) {
  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Closed trades · Tradier</p>
        <h1>Performance</h1>
        <p>
          Realized gain/loss from broker closes ({data.mode} · {data.accountId})
        </p>
      </header>

      <div className="metric-grid">
        <Metric
          label="Realized P&L"
          value={money(data.totals.realizedPl)}
          tone={plClass(data.totals.realizedPl)}
        />
        <Metric label="Trades" value={String(data.totals.tradeCount)} />
        <Metric label="Win rate" value={pct(data.totals.winRate)} />
        <Metric
          label="W / L"
          value={`${data.totals.winners} / ${data.totals.losers}`}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Cumulative</h2>
        </div>
        <CumulativeChart series={data.cumulativeSeries} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Monthly P&amp;L</h2>
        </div>
        <MonthlyBars monthly={data.monthly} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Recent closes</h2>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Close</th>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Proceeds</th>
                <th>P&amp;L</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {data.recentClosed.map((t, i) => (
                <tr key={`${t.symbol}-${t.closeDate}-${i}`}>
                  <td>{t.closeDate.slice(0, 10)}</td>
                  <td>{t.symbol}</td>
                  <td>{t.quantity}</td>
                  <td>{money(t.proceeds)}</td>
                  <td className={plClass(t.gainLoss)}>{money(t.gainLoss)}</td>
                  <td className={plClass(t.gainLossPercent)}>
                    {t.gainLossPercent?.toFixed?.(1) ?? t.gainLossPercent}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function App() {
  const route = useHashRoute();
  const qc = useQueryClient();
  const [loginOpen, setLoginOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => getAuthToken());

  const authQ = useQuery({
    queryKey: ["auth", token],
    queryFn: () => fetchAuthStatus(token),
    refetchInterval: 60_000,
  });

  const statusQ = useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval: (q) =>
      q.state.data?.job?.status === "running" ? 1500 : 15_000,
  });

  const ordersQ = useQuery({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    refetchInterval: 30_000,
    enabled: route === "orders" || route === "overview",
  });

  const positionsQ = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    refetchInterval: 30_000,
    enabled: route === "positions" || route === "overview",
  });

  const perfQ = useQuery({
    queryKey: ["performance"],
    queryFn: fetchPerformance,
    refetchInterval: 60_000,
    enabled: route === "performance" || route === "overview",
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["status"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["positions"] });
    void qc.invalidateQueries({ queryKey: ["performance"] });
  };

  const rebalanceMut = useMutation({
    mutationFn: runRebalance,
    onSuccess: invalidateAll,
  });
  const placeMut = useMutation({
    mutationFn: runPlaceOrders,
    onSuccess: invalidateAll,
  });
  const bothMut = useMutation({
    mutationFn: runRebalanceAndPlace,
    onSuccess: invalidateAll,
  });

  const jobRunning = statusQ.data?.job?.status === "running";
  const authRequired = authQ.data?.authEnabled && !authQ.data?.authenticated;
  const canAct = !authRequired && !jobRunning;

  const guard = (fn: () => void) => {
    if (authRequired) {
      setLoginOpen(true);
      return;
    }
    fn();
  };

  const nav: Array<{ id: Route; href: string; label: string }> = [
    { id: "overview", href: "#/", label: "Overview" },
    { id: "positions", href: "#/positions", label: "Positions" },
    { id: "orders", href: "#/orders", label: "Orders" },
    { id: "performance", href: "#/performance", label: "Performance" },
  ];

  return (
    <>
      <nav className="app-nav">
        <span className="app-nav-brand">σ desk</span>
        {nav.map((n) => (
          <a
            key={n.id}
            href={n.href}
            className={route === n.id ? "active" : undefined}
          >
            {n.label}
          </a>
        ))}
        <span className="nav-auth">
          {authQ.data?.authEnabled ? (
            authQ.data.authenticated ? (
              <button
                type="button"
                className="nav-auth-btn"
                onClick={async () => {
                  if (token) await logout(token);
                  setAuthToken(null);
                  setToken(null);
                  void qc.invalidateQueries({ queryKey: ["auth"] });
                }}
              >
                Lock
              </button>
            ) : (
              <button
                type="button"
                className="nav-auth-btn"
                onClick={() => setLoginOpen(true)}
              >
                Unlock
              </button>
            )
          ) : null}
        </span>
      </nav>

      <div className="actions">
        <button
          type="button"
          disabled={!canAct || rebalanceMut.isPending}
          onClick={() => guard(() => rebalanceMut.mutate())}
        >
          Rebalance
        </button>
        <button
          type="button"
          disabled={!canAct || placeMut.isPending}
          onClick={() => guard(() => placeMut.mutate())}
        >
          Place orders
        </button>
        <button
          type="button"
          disabled={!canAct || bothMut.isPending}
          onClick={() => guard(() => bothMut.mutate())}
        >
          Rebalance + place
        </button>
        {(rebalanceMut.isError || placeMut.isError || bothMut.isError) && (
          <span className="error-msg">
            {(
              (rebalanceMut.error ||
                placeMut.error ||
                bothMut.error) as Error
            ).message}
          </span>
        )}
      </div>

      {statusQ.isError && (
        <p className="error-msg">{(statusQ.error as Error).message}</p>
      )}

      {route === "overview" && statusQ.data && (
        <OverviewPage
          status={statusQ.data}
          positions={positionsQ.data}
          performance={perfQ.data}
          ordersPending={ordersQ.data?.pendingCount ?? 0}
        />
      )}

      {route === "positions" && (
        <>
          {positionsQ.isLoading && <p>Loading positions…</p>}
          {positionsQ.isError && (
            <p className="error-msg">{(positionsQ.error as Error).message}</p>
          )}
          {positionsQ.data && <PositionsPage data={positionsQ.data} />}
        </>
      )}

      {route === "orders" && (
        <>
          {ordersQ.isLoading && <p>Loading orders…</p>}
          {ordersQ.isError && (
            <p className="error-msg">{(ordersQ.error as Error).message}</p>
          )}
          {ordersQ.data && (
            <OrdersPage
              orders={ordersQ.data.orders}
              quotesOk={ordersQ.data.quotesOk}
              quotesMessage={ordersQ.data.quotesMessage}
            />
          )}
        </>
      )}

      {route === "performance" && (
        <>
          {perfQ.isLoading && <p>Loading performance…</p>}
          {perfQ.isError && (
            <p className="error-msg">{(perfQ.error as Error).message}</p>
          )}
          {perfQ.data && <PerformancePage data={perfQ.data} />}
        </>
      )}

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLoggedIn={() => {
          setToken(getAuthToken());
          void qc.invalidateQueries({ queryKey: ["auth"] });
        }}
      />
    </>
  );
}
