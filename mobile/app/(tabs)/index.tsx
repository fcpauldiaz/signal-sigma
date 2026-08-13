import { StyleSheet, Text, View } from "react-native";
import { ActionBar } from "../../src/components/ActionBar";
import { CumulativeChart } from "../../src/components/CumulativeChart";
import { Panel } from "../../src/components/Panel";
import { Screen } from "../../src/components/Screen";
import { StatusDot } from "../../src/components/StatusDot";
import { ErrorText, Muted } from "../../src/components/Typography";
import { money, pct, plClass } from "../../src/format";
import { useDeskQueries } from "../../src/hooks";
import { colors, fonts, space } from "../../src/theme";

export default function OverviewScreen() {
  const { statusQ, ordersQ, positionsQ, perfQ } = useDeskQueries();
  const status = statusQ.data;
  const positions = positionsQ.data;
  const performance = perfQ.data;
  const refreshing =
    statusQ.isRefetching ||
    ordersQ.isRefetching ||
    positionsQ.isRefetching ||
    perfQ.isRefetching;

  const onRefresh = () => {
    void statusQ.refetch();
    void ordersQ.refetch();
    void positionsQ.refetch();
    void perfQ.refetch();
  };

  if (statusQ.isError) {
    return (
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <ErrorText>{(statusQ.error as Error).message}</ErrorText>
      </Screen>
    );
  }

  if (!status) {
    return (
      <Screen onRefresh={onRefresh} refreshing>
        <Muted>Loading overview…</Muted>
      </Screen>
    );
  }

  const equity = positions?.balances.totalEquity ?? status.tradier.totalEquity;
  const openPl = positions?.balances.openPl;
  const realized = performance?.totals.realizedPl;
  const mode = status.tradingMode || status.tradier.mode || "—";

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <View>
        <Text style={styles.kicker}>
          {mode} · {status.tradier.accountId || "—"}
          {status.signalSigma.portfolio
            ? ` · ${status.signalSigma.portfolio.title}`
            : ""}
        </Text>
        <Text style={styles.equity}>{money(equity)}</Text>
        <Text style={styles.equityLabel}>equity</Text>
      </View>

      <View style={styles.ticker}>
        <Ticker label="Open P&L" value={money(openPl)} tone={plClass(openPl)} />
        <Ticker
          label="Realized"
          value={money(realized)}
          tone={plClass(realized)}
        />
        <Ticker
          label="Orders"
          value={String(ordersQ.data?.pendingCount ?? 0)}
        />
      </View>

      <View style={styles.stats}>
        <StatusDot ok={status.signalSigma.ok} label="Signal Sigma" />
        <StatusDot ok={status.tradier.ok} label="Tradier" />
      </View>

      <ActionBar />

      {performance && performance.cumulativeSeries.length > 0 && (
        <Panel
          title="Cumulative realized"
          meta={`${performance.totals.tradeCount} closes · win ${pct(performance.totals.winRate)}`}
        >
          <CumulativeChart series={performance.cumulativeSeries} />
        </Panel>
      )}

      {status.job && (
        <Panel
          title={`Last job · ${status.job.kind}`}
          meta={
            <StatusDot
              tone={
                status.job.status === "success"
                  ? "ok"
                  : status.job.status === "error"
                    ? "warn"
                    : "off"
              }
              label={status.job.status}
            />
          }
        >
          <Muted>
            {status.job.message || "—"}
            {status.job.result
              ? ` · placed ${status.job.result.placedCount ?? 0} · confirmed ${status.job.result.confirmedCount ?? 0} · skipped ${status.job.result.skippedCount ?? 0}`
              : ""}
          </Muted>
        </Panel>
      )}
    </Screen>
  );
}

function Ticker({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "";
}) {
  return (
    <View style={styles.tick}>
      <Text style={styles.tickLabel}>{label}</Text>
      <Text
        style={[
          styles.tickValue,
          tone === "pos" && styles.pos,
          tone === "neg" && styles.neg,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  equity: {
    fontFamily: fonts.monoSemi,
    fontSize: 36,
    color: colors.ink,
    marginTop: space[8],
    letterSpacing: -0.6,
  },
  equityLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.faint,
    marginTop: space[4],
  },
  ticker: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  tick: {
    flex: 1,
    paddingVertical: space[12],
    paddingRight: space[8],
  },
  tickLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.faint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: space[4],
  },
  tickValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 14,
    color: colors.ink,
  },
  pos: { color: colors.positive },
  neg: { color: colors.negative },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[8],
    alignItems: "center",
  },
});
