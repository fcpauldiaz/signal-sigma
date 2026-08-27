import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  fetchAuthStatus,
  fetchOrders,
  fetchPerformance,
  fetchPositions,
  fetchSchwabAuthUrl,
  fetchSchwabPerformance,
  fetchSchwabPositions,
  fetchStatus,
  getAuthToken,
  getTradingMode,
  login,
  logout,
  runPlaceOrders,
  runRebalance,
  runRebalanceAndPlace,
  setAuthToken,
  setTradingMode,
  updateExecution,
  type OpenOrderRow,
  type PerformanceResponse,
  type PositionsResponse,
  type SchwabPerformanceResponse,
  type SchwabPositionsResponse,
  type StatusResponse,
  type TradingMode,
} from "./api";

type Route = "overview" | "positions" | "orders" | "performance" | "schwab";
type AssetFilter = "all" | "stocks" | "options";

const OCC_OPTION = /^[A-Z]{1,6}\s*\d{6}[CP]\d{8}$/i;
const ASSET_FILTER_KEY = "signal_sigma_asset_filter";

function isOptionSymbol(symbol: string): boolean {
  return OCC_OPTION.test(symbol.trim());
}

function matchesAssetFilter(symbol: string, filter: AssetFilter): boolean {
  if (filter === "all") return true;
  return isOptionSymbol(symbol) === (filter === "options");
}

function parseAssetFilter(value: string | null): AssetFilter {
  if (value === "stocks" || value === "options") return value;
  return "all";
}

function filteredOpenPl(
  filter: AssetFilter,
  accountOpenPl: number | null | undefined,
  brokerPositions: PositionsResponse["brokerPositions"] | undefined
): number | null | undefined {
  if (filter === "all") return accountOpenPl;
  if (!brokerPositions) return undefined;
  return brokerPositions
    .filter((p) => matchesAssetFilter(p.symbol, filter))
    .reduce((sum, p) => sum + (p.openPl ?? 0), 0);
}

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
  if (path.startsWith("schwab")) return "schwab";
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

function calendarYearEt(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());
}

function realizedYtdFromTrades(
  trades: Array<{ closeDate: string; gainLoss: number }>
): number {
  const year = calendarYearEt();
  return trades.reduce(
    (sum, trade) =>
      trade.closeDate.slice(0, 4) === year ? sum + trade.gainLoss : sum,
    0
  );
}

function ytdTotal(
  realizedYtd: number | undefined,
  openPl: number | null | undefined
): number {
  return (realizedYtd ?? 0) + (openPl ?? 0);
}

function ytdReturnPct(
  ytdPl: number,
  equity: number | null | undefined
): number | null {
  if (equity == null || Number.isNaN(equity)) return null;
  const startEquity = equity - ytdPl;
  if (startEquity === 0) return null;
  return ytdPl / startEquity;
}

function formatYtd(
  realizedYtd: number | undefined,
  openPl: number | null | undefined,
  equity: number | null | undefined
): { pl: number; value: string; tone: "" | "pos" | "neg" } {
  const pl = ytdTotal(realizedYtd, openPl);
  const percent = ytdReturnPct(pl, equity);
  return {
    pl,
    value: `${money(pl)} · ${pct(percent)}`,
    tone: plClass(pl),
  };
}

function plClass(n: number | null | undefined): "" | "pos" | "neg" {
  if (n == null || n === 0) return "";
  return n > 0 ? "pos" : "neg";
}

function ownershipPlPercent(
  ownershipPrice: number | null | undefined,
  marketPrice: number | null | undefined
): number | null {
  if (
    ownershipPrice == null ||
    marketPrice == null ||
    !(ownershipPrice > 0) ||
    Number.isNaN(marketPrice)
  ) {
    return null;
  }
  return ((marketPrice - ownershipPrice) / ownershipPrice) * 100;
}

function isCashBookRow(row: {
  symbol: string;
  strategy: string | null;
  systemClassification?: string | null;
}): boolean {
  if (row.systemClassification?.trim().toLowerCase() === "cash") return true;
  if ((row.strategy || "").trim().toLowerCase() === "cash") return true;
  const symbol = row.symbol.trim().toUpperCase();
  return symbol.startsWith("TOTAL ");
}

type ClosedTrade = PerformanceResponse["recentClosed"][number];

const CLOSED_CSV_HEADERS = [
  "close_date",
  "symbol",
  "quantity",
  "cost",
  "proceeds",
  "gain_loss",
  "gain_loss_percent",
  "open_date",
] as const;

function csvCell(value: string | number): string {
  const raw = String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function closedTradesToCsv(trades: ClosedTrade[]): string {
  const rows = trades.map((t) =>
    [
      t.closeDate.slice(0, 10),
      t.symbol,
      t.quantity,
      t.cost,
      t.proceeds,
      t.gainLoss,
      t.gainLossPercent,
      t.openDate.slice(0, 10),
    ]
      .map(csvCell)
      .join(",")
  );
  return [CLOSED_CSV_HEADERS.join(","), ...rows].join("\n");
}

function downloadTextFile(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ClosedTradesCsv({
  trades,
  mode,
  accountId,
  assetFilter,
}: {
  trades: ClosedTrade[];
  mode: string;
  accountId: string;
  assetFilter: AssetFilter;
}) {
  const suffix = assetFilter === "all" ? "" : `-${assetFilter}`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Last {trades.length} closes</h2>
        <button
          type="button"
          onClick={() =>
            downloadTextFile(
              `closes-${mode}-${accountId || "account"}${suffix}.csv`,
              closedTradesToCsv(trades),
              "text/csv;charset=utf-8"
            )
          }
        >
          Download CSV
        </button>
      </div>
    </section>
  );
}

function performanceForFilter<
  T extends PerformanceResponse | SchwabPerformanceResponse,
>(data: T, filter: AssetFilter): T {
  if (filter === "all") return data;

  const trades = data.recentClosed.filter((t) =>
    matchesAssetFilter(t.symbol, filter)
  );
  const sorted = trades
    .slice()
    .sort((a, b) => a.closeDate.localeCompare(b.closeDate));

  const monthlyMap = new Map<string, number>();
  let cumulative = 0;
  const cumulativeSeries: PerformanceResponse["cumulativeSeries"] = sorted.map(
    (trade) => {
      const month = trade.closeDate.slice(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) || 0) + trade.gainLoss);
      cumulative += trade.gainLoss;
      return {
        date: trade.closeDate.slice(0, 10),
        cumulative,
        gainLoss: trade.gainLoss,
        symbol: trade.symbol,
        quantity: trade.quantity,
        cost: trade.cost,
        proceeds: trade.proceeds,
        gainLossPercent: trade.gainLossPercent,
        openDate: trade.openDate,
        closeDate: trade.closeDate,
      };
    }
  );

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, gainLoss]) => ({ month, gainLoss }));
  const winners = sorted.filter((t) => t.gainLoss > 0).length;
  const losers = sorted.filter((t) => t.gainLoss < 0).length;

  return {
    ...data,
    totals: {
      realizedPl: cumulative,
      realizedYtd: realizedYtdFromTrades(sorted),
      tradeCount: sorted.length,
      winners,
      losers,
      winRate: sorted.length ? winners / sorted.length : 0,
    },
    monthly,
    cumulativeSeries,
    recentClosed: sorted.slice().reverse(),
  };
}

type DeskAction = "rebalance" | "place" | "both";

function deskActionCopy(action: DeskAction, mode: TradingMode) {
  switch (action) {
    case "rebalance":
      return {
        title: "Rebalance",
        confirm: "Rebalance",
        body: `Recalculate ${mode} targets. No orders are sent.`,
      };
    case "place":
      return {
        title: "Place orders",
        confirm: "Place orders",
        body: `Send eligible pending orders to Tradier ${mode}.`,
      };
    case "both":
      return {
        title: "Rebalance + place",
        confirm: "Rebalance + place",
        body: `Recalculate ${mode} targets, then send eligible orders to Tradier.`,
      };
  }
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

function Dialog({
  open,
  title,
  kicker,
  kickerLive,
  labelledBy,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  kicker?: string;
  kickerLive?: boolean;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {kicker ? (
          <p className={`modal-kicker ${kickerLive ? "live" : ""}`}>{kicker}</p>
        ) : null}
        <h2 id={labelledBy}>{title}</h2>
        {children}
      </div>
    </div>
  );
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

  return (
    <Dialog
      open={open}
      title="Unlock desk"
      labelledBy="login-title"
      onClose={onClose}
    >
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
    </Dialog>
  );
}

function ConfirmModal({
  action,
  mode,
  onConfirm,
  onClose,
}: {
  action: DeskAction | null;
  mode: TradingMode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy = action ? deskActionCopy(action, mode) : null;
  const live = mode === "live";

  return (
    <Dialog
      open={Boolean(copy)}
      title={copy?.title ?? ""}
      kicker={copy ? mode : undefined}
      kickerLive={live}
      labelledBy="confirm-title"
      onClose={onClose}
    >
      {copy && (
        <>
          <p>{copy.body}</p>
          <div className="actions" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={live ? "confirm-live" : undefined}
              autoFocus
              onClick={onConfirm}
            >
              {copy.confirm}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

type CumulativePoint = PerformanceResponse["cumulativeSeries"][number];

function CumulativeChart({ series }: { series: CumulativePoint[] }) {
  const w = 640;
  const h = 220;
  const pad = { t: 16, r: 16, b: 28, l: 52 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIndex(null);
  }, [series]);

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

  const togglePoint = (i: number) => {
    setSelectedIndex((cur) => (cur === i ? null : i));
  };

  if (!points) {
    return <p>No closed trades yet.</p>;
  }

  const ticks = [points.minY, 0, points.maxY].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  const selected =
    selectedIndex != null && selectedIndex < points.coords.length
      ? points.coords[selectedIndex]
      : undefined;

  const selectNearest = (clientX: number, svg: SVGSVGElement) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    if (loc.x < pad.l || loc.x > w - pad.r) return;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < points.coords.length; i++) {
      const d = Math.abs(points.coords[i].x - loc.x);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    togglePoint(nearest);
  };

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        onClick={(e) => selectNearest(e.clientX, e.currentTarget)}
      >
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
        {points.coords.map((c, i) => {
          const isSelected = selectedIndex === i;
          return (
            <g key={`${c.symbol}-${c.closeDate}-${i}`}>
              <circle
                className={`chart-dot${isSelected ? " selected" : ""}`}
                cx={c.x}
                cy={c.y}
                r={isSelected ? 5 : 3}
              />
              <circle
                className="chart-dot-hit"
                cx={c.x}
                cy={c.y}
                r={10}
                role="button"
                tabIndex={0}
                aria-label={`${c.symbol} ${c.date} ${money(c.gainLoss)}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    togglePoint(i);
                  }
                }}
              >
                <title>
                  {c.date} · {c.symbol} · {money(c.gainLoss)}
                </title>
              </circle>
            </g>
          );
        })}
        <text className="chart-axis" x={pad.l} y={h - 6}>
          {series[0]?.date}
        </text>
        <text className="chart-axis" x={w - pad.r} y={h - 6} textAnchor="end">
          {series[series.length - 1]?.date}
        </text>
      </svg>
      {selected ? (
        <div className="chart-detail">
          <div className="chart-detail-head">
            <p className="chart-detail-title">
              {selected.symbol} · closed {selected.date}
              {selected.openDate ? ` · opened ${selected.openDate.slice(0, 10)}` : ""}
            </p>
            <button type="button" className="chart-detail-clear" onClick={() => setSelectedIndex(null)}>
              Clear
            </button>
          </div>
          <dl className="chart-detail-stats">
            <div>
              <dt>Qty</dt>
              <dd>{selected.quantity}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{money(selected.cost)}</dd>
            </div>
            <div>
              <dt>Proceeds</dt>
              <dd>{money(selected.proceeds)}</dd>
            </div>
            <div>
              <dt>Trade P&amp;L</dt>
              <dd className={plClass(selected.gainLoss)}>{money(selected.gainLoss)}</dd>
            </div>
            <div>
              <dt>P&amp;L %</dt>
              <dd className={plClass(selected.gainLossPercent)}>
                {selected.gainLossPercent?.toFixed?.(1) ?? selected.gainLossPercent}%
              </dd>
            </div>
            <div>
              <dt>Cumulative</dt>
              <dd className={plClass(selected.cumulative)}>{money(selected.cumulative)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="chart-hint">Click a close to inspect P&amp;L</p>
      )}
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
  schwabPositions,
  schwabPerformance,
  ordersPending,
  assetFilter,
}: {
  status: StatusResponse;
  positions?: PositionsResponse;
  performance?: PerformanceResponse;
  schwabPositions?: SchwabPositionsResponse;
  schwabPerformance?: SchwabPerformanceResponse;
  ordersPending: number;
  assetFilter: AssetFilter;
}) {
  const equity = positions?.balances.totalEquity ?? status.tradier.totalEquity;
  const openPl = filteredOpenPl(
    assetFilter,
    positions?.balances.openPl,
    positions?.brokerPositions
  );
  const realized = performance?.totals.realizedPl;
  const schwabOpenPl = filteredOpenPl(
    assetFilter,
    schwabPositions?.balances.openPl,
    schwabPositions?.brokerPositions
  );
  const schwabEquity = schwabPositions?.balances.totalEquity;
  const schwabRealized = schwabPerformance?.totals.realizedPl;
  const combinedEquity =
    equity != null || schwabEquity != null
      ? (equity ?? 0) + (schwabEquity ?? 0)
      : null;
  const combinedOpen =
    openPl != null || schwabOpenPl != null
      ? (openPl ?? 0) + (schwabOpenPl ?? 0)
      : null;
  const combinedRealized =
    realized != null || schwabRealized != null
      ? (realized ?? 0) + (schwabRealized ?? 0)
      : null;
  const tradierYtd = formatYtd(
    performance?.totals.realizedYtd ??
      (performance ? realizedYtdFromTrades(performance.recentClosed) : 0),
    openPl,
    equity
  );
  const schwabYtd = formatYtd(
    schwabPerformance?.totals.realizedYtd ??
      (schwabPerformance
        ? realizedYtdFromTrades(schwabPerformance.recentClosed)
        : 0),
    schwabOpenPl,
    schwabEquity
  );
  const combinedYtdPl = tradierYtd.pl + (schwabPositions?.connected ? schwabYtd.pl : 0);
  const combinedYtd = {
    value: `${money(combinedYtdPl)} · ${pct(ytdReturnPct(combinedYtdPl, combinedEquity))}`,
    tone: plClass(combinedYtdPl),
  };

  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Signal Sigma · desk</p>
        <h1>Overview</h1>
        <p>
          Track equity, open risk, and realized P&amp;L for{" "}
          <code>{status.tradier.accountId || "—"}</code> (
          {status.tradingMode || status.tradier.mode || "—"})
          {status.signalSigma.portfolio ? (
            <>
              {" "}
              · SS <code>{status.signalSigma.portfolio.title}</code>
            </>
          ) : null}
        </p>
      </header>

      <div className="stats-inline">
        <StatusDot ok={status.signalSigma.ok} label="Signal Sigma" />
        <StatusDot ok={status.tradier.ok} label="Tradier" />
        <StatusDot
          ok={Boolean(status.schwab?.ok)}
          label={
            status.schwab?.needsReauth
              ? "Schwab · re-auth"
              : status.schwab?.configured
                ? "Schwab"
                : "Schwab · off"
          }
        />
        <span>
          Coolify cron · rebalance {status.schedules.rebalance} · orders{" "}
          {status.schedules.orders}
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
        <Metric
          label={`YTD P&L · ${calendarYearEt()}`}
          value={tradierYtd.value}
          tone={tradierYtd.tone}
        />
        <Metric label="Open orders" value={String(ordersPending)} />
      </div>

      {schwabPositions?.connected ? (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Combined · Tradier + Schwab</h2>
            <span className="status connected">two strategies</span>
          </div>
          <div className="metric-grid">
            <Metric label="Combined equity" value={money(combinedEquity)} />
            <Metric
              label="Combined open P&L"
              value={money(combinedOpen)}
              tone={plClass(combinedOpen)}
            />
            <Metric
              label="Combined realized"
              value={money(combinedRealized)}
              tone={plClass(combinedRealized)}
            />
            <Metric
              label={`Combined YTD · ${calendarYearEt()}`}
              value={combinedYtd.value}
              tone={combinedYtd.tone}
            />
            <Metric
              label="Schwab equity"
              value={money(schwabEquity)}
            />
          </div>
        </section>
      ) : null}

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

      {performance && performance.recentClosed.length > 0 && (
        <ClosedTradesCsv
          trades={performance.recentClosed}
          mode={performance.mode}
          accountId={performance.accountId}
          assetFilter={assetFilter}
        />
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

function signalPositionCells(t: PositionsResponse["signalPositions"][number]) {
  return (
    <>
      <td>{t.symbol}</td>
      <td>{t.strategy || (isCashBookRow(t) ? "Cash" : "—")}</td>
      <td>{t.amount}</td>
      <td>{t.targetAmount}</td>
      <td>{money(t.ownershipPrice)}</td>
      <td>{money(t.lastPrice)}</td>
      <td>{money(t.value)}</td>
      <td>{t.percent?.toFixed?.(1) ?? t.percent}%</td>
    </>
  );
}

function PositionsPage({
  data,
  assetFilter,
}: {
  data: PositionsResponse;
  assetFilter: AssetFilter;
}) {
  const brokerPositions = data.brokerPositions.filter((p) =>
    matchesAssetFilter(p.symbol, assetFilter)
  );
  const holdings = data.signalPositions
    .filter((t) => !isCashBookRow(t))
    .filter((t) => matchesAssetFilter(t.symbol, assetFilter));
  const cashRows =
    assetFilter === "all"
      ? data.signalPositions.filter((t) => isCashBookRow(t))
      : [];
  const marketValue =
    assetFilter === "all"
      ? data.balances.marketValue
      : brokerPositions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
  const openPl = filteredOpenPl(
    assetFilter,
    data.balances.openPl,
    data.brokerPositions
  );
  const signalValue =
    assetFilter === "all"
      ? data.signalPortfolioValue
      : holdings.reduce((sum, t) => sum + (t.value || 0), 0);

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
        <Metric label="Market value" value={money(marketValue)} />
        <Metric
          label="Open P&L"
          value={money(openPl)}
          tone={plClass(openPl)}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Broker positions</h2>
          <span>{brokerPositions.length} symbols</span>
        </div>
        {brokerPositions.length === 0 ? (
          <p>
            {assetFilter === "all"
              ? "No open broker positions (cash)."
              : `No open ${assetFilter} positions.`}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Avg cost</th>
                  <th>Last</th>
                  <th>Mkt value</th>
                  <th>Open P&L</th>
                  <th>P&L %</th>
                  <th>Acquired</th>
                </tr>
              </thead>
              <tbody>
                {brokerPositions.map((p) => (
                  <tr key={p.symbol}>
                    <td>{p.symbol}</td>
                    <td>{p.quantity}</td>
                    <td>{money(p.avgCost)}</td>
                    <td>{money(p.lastPrice)}</td>
                    <td>{money(p.marketValue)}</td>
                    <td>
                      <span className={`pl ${plClass(p.openPl)}`.trim()}>
                        {money(p.openPl)}
                      </span>
                    </td>
                    <td>
                      <span className={`pl ${plClass(p.openPlPercent)}`.trim()}>
                        {p.openPlPercent == null
                          ? "—"
                          : `${p.openPlPercent.toFixed(1)}%`}
                      </span>
                    </td>
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
            {holdings.length} · {money(signalValue)} ·{" "}
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
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    {assetFilter === "all"
                      ? "No Signal Sigma positions."
                      : `No ${assetFilter} in the Signal Sigma book.`}
                  </td>
                </tr>
              ) : (
                holdings.map((t) => (
                  <tr key={t.symbol}>{signalPositionCells(t)}</tr>
                ))
              )}
            </tbody>
            {cashRows.length > 0 && (
              <tfoot>
                {cashRows.map((t) => (
                  <tr key={t.symbol}>{signalPositionCells(t)}</tr>
                ))}
              </tfoot>
            )}
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
  assetFilter,
}: {
  orders: OpenOrderRow[];
  quotesOk: boolean;
  quotesMessage: string;
  assetFilter: AssetFilter;
}) {
  const visible = orders.filter((o) => matchesAssetFilter(o.symbol, assetFilter));
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
          {visible.filter((o) => o.eligible).length} eligible / {visible.length}{" "}
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
                <th>P&L %</th>
                <th>Value</th>
                <th>Ready</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    {assetFilter === "all"
                      ? "No pending orders."
                      : `No pending ${assetFilter} orders.`}
                  </td>
                </tr>
              ) : (
                visible.map((o) => {
                  const plPercent = ownershipPlPercent(
                    o.ownershipPrice,
                    o.marketPrice
                  );
                  return (
                    <tr key={o.id}>
                      <td className={o.direction === "BUY" ? "pos" : "neg"}>
                        {o.direction}
                      </td>
                      <td>{o.symbol}</td>
                      <td>{o.strategy || "—"}</td>
                      <td>{o.quantity ?? Math.abs(o.amount)}</td>
                      <td>{money(o.ownershipPrice)}</td>
                      <td>{money(o.price)}</td>
                      <td>{money(o.marketPrice)}</td>
                      <td>
                        <span className={`pl ${plClass(plPercent)}`.trim()}>
                          {plPercent == null ? "—" : `${plPercent.toFixed(1)}%`}
                        </span>
                      </td>
                      <td>{money(o.value)}</td>
                      <td>
                        {o.eligible ? (
                          <span className="status connected">yes</span>
                        ) : (
                          <span
                            className="status warn"
                            title={o.skipReason || ""}
                          >
                            no
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
        </table>
      </div>
    </>
  );
}

function PerformancePage({
  data,
  assetFilter,
  openPl,
}: {
  data: PerformanceResponse;
  assetFilter: AssetFilter;
  openPl: number | null | undefined;
}) {
  const ytd = formatYtd(
    data.totals.realizedYtd ?? realizedYtdFromTrades(data.recentClosed),
    openPl,
    data.balances.totalEquity
  );
  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Closed trades · Tradier</p>
        <h1>Performance</h1>
        <p>
          Open marks and realized closes ({data.mode} · {data.accountId})
        </p>
      </header>

      <div className="metric-grid">
        <Metric
          label="Open P&L"
          value={money(openPl)}
          tone={plClass(openPl)}
        />
        <Metric
          label="Realized P&L"
          value={money(data.totals.realizedPl)}
          tone={plClass(data.totals.realizedPl)}
        />
        <Metric
          label={`YTD P&L · ${calendarYearEt()}`}
          value={ytd.value}
          tone={ytd.tone}
        />
        <Metric label="Trades" value={String(data.totals.tradeCount)} />
        <Metric label="Win rate" value={pct(data.totals.winRate)} />
        <Metric
          label="W / L"
          value={`${data.totals.winners} / ${data.totals.losers}`}
        />
      </div>

      <ClosedTradesCsv
        trades={data.recentClosed}
        mode={data.mode}
        accountId={data.accountId}
        assetFilter={assetFilter}
      />

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
    </>
  );
}

function schwabHashError(): string | null {
  const hash = location.hash.replace(/^#\/?/, "");
  const qIndex = hash.indexOf("?");
  if (qIndex < 0) return null;
  return new URLSearchParams(hash.slice(qIndex + 1)).get("schwab_error");
}

function SchwabPage({
  positions,
  performance,
  assetFilter,
  oauthError,
  onAuthorize,
  authorizing,
  authorizeError,
}: {
  positions?: SchwabPositionsResponse;
  performance?: SchwabPerformanceResponse;
  assetFilter: AssetFilter;
  oauthError: string | null;
  onAuthorize: () => void;
  authorizing: boolean;
  authorizeError: string | null;
}) {
  const connected = Boolean(positions?.connected);
  const brokerPositions = (positions?.brokerPositions ?? []).filter((p) =>
    matchesAssetFilter(p.symbol, assetFilter)
  );
  const openPl = filteredOpenPl(
    assetFilter,
    positions?.balances.openPl,
    positions?.brokerPositions
  );
  const filteredPerf = performance
    ? performanceForFilter(performance, assetFilter)
    : undefined;
  const historyFrom = performance?.historyFrom?.slice(0, 10);
  const historyTo = performance?.historyTo?.slice(0, 10);
  const ytd = formatYtd(
    filteredPerf?.totals.realizedYtd ??
      (filteredPerf ? realizedYtdFromTrades(filteredPerf.recentClosed) : 0),
    openPl,
    positions?.balances.totalEquity
  );

  return (
    <>
      <header className="workbench-header">
        <p className="workbench-kicker">Charles Schwab · read-only</p>
        <h1>Schwab</h1>
        <p>
          Separate strategy book
          {positions?.accountId ? (
            <>
              {" "}
              · <code>{positions.accountId}</code>
            </>
          ) : null}
          {historyFrom && historyTo ? (
            <>
              {" "}
              · realized window {historyFrom} → {historyTo}
            </>
          ) : null}
        </p>
      </header>

      <div className="stats-inline">
        <StatusDot
          ok={connected}
          label={
            connected
              ? "Schwab connected"
              : positions?.configured
                ? "Schwab disconnected"
                : "Schwab not configured"
          }
        />
        {positions?.needsReauth ? (
          <span className="status warn">Re-authorize</span>
        ) : null}
        <button
          type="button"
          disabled={authorizing || positions?.configured === false}
          onClick={onAuthorize}
        >
          {authorizing ? "Opening Schwab…" : "Authorize Schwab"}
        </button>
      </div>

      {oauthError && <p className="error-msg">{oauthError}</p>}
      {authorizeError && <p className="error-msg">{authorizeError}</p>}
      {positions && !connected && (
        <p>
          {positions.message ||
            "Set SCHWAB_APP_KEY, SCHWAB_APP_SECRET, and SCHWAB_CALLBACK_URL, then authorize."}
        </p>
      )}

      {connected && (
        <>
          <div className="metric-grid">
            <Metric
              label="Equity"
              value={money(positions?.balances.totalEquity)}
            />
            <Metric label="Cash" value={money(positions?.balances.totalCash)} />
            <Metric
              label="Open P&L"
              value={money(openPl)}
              tone={plClass(openPl)}
            />
            <Metric
              label="Realized P&L"
              value={money(filteredPerf?.totals.realizedPl)}
              tone={plClass(filteredPerf?.totals.realizedPl)}
            />
            <Metric
              label={`YTD P&L · ${calendarYearEt()}`}
              value={ytd.value}
              tone={ytd.tone}
            />
            <Metric
              label="Win rate"
              value={pct(filteredPerf?.totals.winRate)}
            />
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Broker positions</h2>
              <span>{brokerPositions.length} symbols</span>
            </div>
            {brokerPositions.length === 0 ? (
              <p>
                {assetFilter === "all"
                  ? "No open Schwab positions (cash)."
                  : `No open Schwab ${assetFilter} positions.`}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Qty</th>
                      <th>Avg cost</th>
                      <th>Last</th>
                      <th>Mkt value</th>
                      <th>Open P&L</th>
                      <th>P&L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brokerPositions.map((p) => (
                      <tr key={p.symbol}>
                        <td>{p.symbol}</td>
                        <td>{p.quantity}</td>
                        <td>{money(p.avgCost)}</td>
                        <td>{money(p.lastPrice)}</td>
                        <td>{money(p.marketValue)}</td>
                        <td>
                          <span className={`pl ${plClass(p.openPl)}`.trim()}>
                            {money(p.openPl)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`pl ${plClass(p.openPlPercent)}`.trim()}
                          >
                            {p.openPlPercent == null
                              ? "—"
                              : `${p.openPlPercent.toFixed(1)}%`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {filteredPerf && (
            <>
              <ClosedTradesCsv
                trades={filteredPerf.recentClosed}
                mode="schwab"
                accountId={filteredPerf.accountId}
                assetFilter={assetFilter}
              />
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Cumulative</h2>
                </div>
                <CumulativeChart series={filteredPerf.cumulativeSeries} />
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Monthly P&amp;L</h2>
                </div>
                <MonthlyBars monthly={filteredPerf.monthly} />
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function App() {
  const route = useHashRoute();
  const qc = useQueryClient();
  const [loginOpen, setLoginOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<DeskAction | null>(null);
  const [pushWarning, setPushWarning] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [mode, setMode] = useState<TradingMode>(() => getTradingMode());
  const [assetFilter, setAssetFilter] = useState<AssetFilter>(() =>
    parseAssetFilter(localStorage.getItem(ASSET_FILTER_KEY))
  );

  const switchAssetFilter = (next: AssetFilter) => {
    setAssetFilter(next);
    localStorage.setItem(ASSET_FILTER_KEY, next);
  };

  const switchMode = (next: TradingMode) => {
    setTradingMode(next);
    setMode(next);
    void qc.invalidateQueries();
  };

  const authQ = useQuery({
    queryKey: ["auth", token],
    queryFn: () => fetchAuthStatus(token),
    refetchInterval: 60_000,
  });

  const statusQ = useQuery({
    queryKey: ["status", mode],
    queryFn: fetchStatus,
    refetchInterval: (q) =>
      q.state.data?.job?.status === "running" ? 1500 : 15_000,
  });

  const ordersQ = useQuery({
    queryKey: ["orders", mode],
    queryFn: fetchOrders,
    refetchInterval: 30_000,
    enabled: route === "orders" || route === "overview",
  });

  const positionsQ = useQuery({
    queryKey: ["positions", mode],
    queryFn: fetchPositions,
    refetchInterval: 30_000,
    enabled:
      route === "positions" ||
      route === "overview" ||
      route === "performance",
  });

  const perfQ = useQuery({
    queryKey: ["performance", mode],
    queryFn: fetchPerformance,
    refetchInterval: 60_000,
    enabled: route === "performance" || route === "overview",
  });

  const schwabPositionsQ = useQuery({
    queryKey: ["schwab-positions"],
    queryFn: fetchSchwabPositions,
    refetchInterval: 30_000,
    enabled: route === "schwab" || route === "overview",
  });

  const schwabPerfQ = useQuery({
    queryKey: ["schwab-performance"],
    queryFn: fetchSchwabPerformance,
    refetchInterval: 60_000,
    enabled: route === "schwab" || route === "overview",
  });

  const filteredPerformance = useMemo(
    () => (perfQ.data ? performanceForFilter(perfQ.data, assetFilter) : undefined),
    [perfQ.data, assetFilter]
  );
  const filteredSchwabPerformance = useMemo(
    () =>
      schwabPerfQ.data
        ? performanceForFilter(schwabPerfQ.data, assetFilter)
        : undefined,
    [schwabPerfQ.data, assetFilter]
  );
  const filteredOrdersPending =
    ordersQ.data?.orders.filter((o) => matchesAssetFilter(o.symbol, assetFilter))
      .length ?? 0;

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["status"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["positions"] });
    void qc.invalidateQueries({ queryKey: ["performance"] });
    void qc.invalidateQueries({ queryKey: ["schwab-positions"] });
    void qc.invalidateQueries({ queryKey: ["schwab-performance"] });
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
  const authorizeSchwabMut = useMutation({
    mutationFn: fetchSchwabAuthUrl,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });
  const executionMut = useMutation({
    mutationFn: updateExecution,
    onSuccess: (data) => {
      setPushWarning(data.push?.warning ?? null);
      void qc.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const jobRunning = statusQ.data?.job?.status === "running";
  const authRequired = authQ.data?.authEnabled && !authQ.data?.authenticated;
  const canAct = !authRequired && !jobRunning;
  const executionEnabled =
    mode === "live"
      ? Boolean(statusQ.data?.execution?.live)
      : Boolean(statusQ.data?.execution?.paper);
  const canPlace = canAct && executionEnabled;

  const requestAction = (action: DeskAction) => {
    if (authRequired) {
      setLoginOpen(true);
      return;
    }
    setPendingAction(action);
  };

  const runPendingAction = () => {
    if (pendingAction === "rebalance") rebalanceMut.mutate();
    else if (pendingAction === "place") placeMut.mutate();
    else if (pendingAction === "both") bothMut.mutate();
    setPendingAction(null);
  };

  const nav: Array<{ id: Route; href: string; label: string }> = [
    { id: "overview", href: "#/", label: "Overview" },
    { id: "positions", href: "#/positions", label: "Positions" },
    { id: "orders", href: "#/orders", label: "Orders" },
    { id: "performance", href: "#/performance", label: "Performance" },
    { id: "schwab", href: "#/schwab", label: "Schwab" },
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
        <span className="mode-switch" role="group" aria-label="Trading mode">
          <button
            type="button"
            className={mode === "paper" ? "active" : undefined}
            onClick={() => switchMode("paper")}
          >
            Paper
          </button>
          <button
            type="button"
            className={mode === "live" ? "active live" : undefined}
            onClick={() => switchMode("live")}
          >
            Live
          </button>
        </span>
        <span className="mode-switch" role="group" aria-label="Asset filter">
          {(["all", "stocks", "options"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={assetFilter === id ? "active" : undefined}
              onClick={() => switchAssetFilter(id)}
            >
              {id === "all" ? "All" : id === "stocks" ? "Stocks" : "Options"}
            </button>
          ))}
        </span>
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
        <div className="execution-toggles">
          <label className="execution-toggle">
            <input
              type="checkbox"
              checked={Boolean(statusQ.data?.execution?.paper)}
              disabled={authRequired || executionMut.isPending}
              onChange={(e) => {
                if (authRequired) {
                  setLoginOpen(true);
                  return;
                }
                executionMut.mutate({ paper: e.target.checked });
              }}
            />
            Paper exec
          </label>
          <label className="execution-toggle live">
            <input
              type="checkbox"
              checked={Boolean(statusQ.data?.execution?.live)}
              disabled={authRequired || executionMut.isPending}
              onChange={(e) => {
                if (authRequired) {
                  setLoginOpen(true);
                  return;
                }
                executionMut.mutate({ live: e.target.checked });
              }}
            />
            Live exec
          </label>
          <span
            className={`status ${
              (statusQ.data?.push?.devices ?? 0) > 0 ? "connected" : "warn"
            }`}
          >
            {(statusQ.data?.push?.devices ?? 0) > 0
              ? `${statusQ.data?.push?.devices} phone${
                  statusQ.data?.push?.devices === 1 ? "" : "s"
                }`
              : "No phone for alerts"}
          </span>
        </div>
        <button
          type="button"
          disabled={!canAct || rebalanceMut.isPending}
          onClick={() => requestAction("rebalance")}
        >
          Rebalance
        </button>
        <button
          type="button"
          disabled={!canPlace || placeMut.isPending}
          title={
            executionEnabled
              ? undefined
              : `Enable ${mode} exec to place orders`
          }
          onClick={() => requestAction("place")}
        >
          Place orders
        </button>
        <button
          type="button"
          disabled={!canPlace || bothMut.isPending}
          title={
            executionEnabled
              ? undefined
              : `Enable ${mode} exec to place orders`
          }
          onClick={() => requestAction("both")}
        >
          Rebalance + place
        </button>
        {!executionEnabled && (
          <span className="status warn">{mode} execution off</span>
        )}
        {pushWarning && <span className="error-msg">{pushWarning}</span>}
        {(rebalanceMut.isError ||
          placeMut.isError ||
          bothMut.isError ||
          executionMut.isError) && (
          <span className="error-msg">
            {(
              (rebalanceMut.error ||
                placeMut.error ||
                bothMut.error ||
                executionMut.error) as Error
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
          performance={filteredPerformance}
          schwabPositions={schwabPositionsQ.data}
          schwabPerformance={filteredSchwabPerformance}
          ordersPending={filteredOrdersPending}
          assetFilter={assetFilter}
        />
      )}

      {route === "positions" && (
        <>
          {positionsQ.isLoading && <p>Loading positions…</p>}
          {positionsQ.isError && (
            <p className="error-msg">{(positionsQ.error as Error).message}</p>
          )}
          {positionsQ.data && (
            <PositionsPage data={positionsQ.data} assetFilter={assetFilter} />
          )}
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
              assetFilter={assetFilter}
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
          {filteredPerformance && (
            <PerformancePage
              data={filteredPerformance}
              assetFilter={assetFilter}
              openPl={filteredOpenPl(
                assetFilter,
                filteredPerformance.balances.openPl ??
                  positionsQ.data?.balances.openPl,
                positionsQ.data?.brokerPositions
              )}
            />
          )}
        </>
      )}

      {route === "schwab" && (
        <>
          {(schwabPositionsQ.isLoading || schwabPerfQ.isLoading) && (
            <p>Loading Schwab…</p>
          )}
          {schwabPositionsQ.isError && (
            <p className="error-msg">
              {(schwabPositionsQ.error as Error).message}
            </p>
          )}
          {schwabPerfQ.isError && (
            <p className="error-msg">{(schwabPerfQ.error as Error).message}</p>
          )}
          <SchwabPage
            positions={schwabPositionsQ.data}
            performance={schwabPerfQ.data}
            assetFilter={assetFilter}
            oauthError={schwabHashError()}
            onAuthorize={() => {
              if (authRequired) {
                setLoginOpen(true);
                return;
              }
              authorizeSchwabMut.mutate();
            }}
            authorizing={authorizeSchwabMut.isPending}
            authorizeError={
              authorizeSchwabMut.isError
                ? (authorizeSchwabMut.error as Error).message
                : null
            }
          />
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
      <ConfirmModal
        action={pendingAction}
        mode={mode}
        onConfirm={runPendingAction}
        onClose={() => setPendingAction(null)}
      />
    </>
  );
}
