import { View } from "react-native";
import { CumulativeChart } from "../../src/components/CumulativeChart";
import { DataCard, MetaLine } from "../../src/components/DataCard";
import { MetricCard, MetricGrid } from "../../src/components/MetricCard";
import { MonthlyBars } from "../../src/components/MonthlyBars";
import { Panel } from "../../src/components/Panel";
import { ListScreen } from "../../src/components/Screen";
import {
  ErrorText,
  Muted,
  PlText,
  ScreenHeader,
} from "../../src/components/Typography";
import { money, pct, plClass } from "../../src/format";
import { useDeskQueries } from "../../src/hooks";
import { space } from "../../src/theme";

export default function PerformanceScreen() {
  const { perfQ } = useDeskQueries();
  const data = perfQ.data;

  const onRefresh = () => {
    void perfQ.refetch();
  };

  if (perfQ.isError) {
    return (
      <ListScreen
        data={[]}
        keyExtractor={() => "err"}
        renderItem={() => null}
        onRefresh={onRefresh}
        refreshing={perfQ.isRefetching}
        header={<ErrorText>{(perfQ.error as Error).message}</ErrorText>}
      />
    );
  }

  if (!data) {
    return (
      <ListScreen
        data={[]}
        keyExtractor={() => "load"}
        renderItem={() => null}
        onRefresh={onRefresh}
        refreshing
        header={<Muted>Loading performance…</Muted>}
      />
    );
  }

  return (
    <ListScreen
      data={data.recentClosed}
      keyExtractor={(t, i) => `${t.symbol}-${t.closeDate}-${i}`}
      onRefresh={onRefresh}
      refreshing={perfQ.isRefetching}
      empty={<Muted>No closed trades yet.</Muted>}
      header={
        <View style={{ gap: space[16], marginBottom: space[12] }}>
          <ScreenHeader kicker="Closed trades · Tradier" title="Performance">
            {data.mode} · {data.accountId}
          </ScreenHeader>
          <MetricGrid>
            <MetricCard
              label="Realized P&L"
              value={money(data.totals.realizedPl)}
              tone={plClass(data.totals.realizedPl)}
            />
            <MetricCard label="Trades" value={String(data.totals.tradeCount)} />
            <MetricCard label="Win rate" value={pct(data.totals.winRate)} />
            <MetricCard
              label="W / L"
              value={`${data.totals.winners} / ${data.totals.losers}`}
            />
          </MetricGrid>
          <Panel title="Cumulative">
            {data.cumulativeSeries.length > 0 ? (
              <CumulativeChart series={data.cumulativeSeries} />
            ) : (
              <Muted>No closed trades yet.</Muted>
            )}
          </Panel>
          <Panel title="Monthly P&L">
            {data.monthly.length > 0 ? (
              <MonthlyBars monthly={data.monthly} />
            ) : (
              <Muted>No monthly P&L yet.</Muted>
            )}
          </Panel>
        </View>
      }
      renderItem={({ item: t }) => (
        <DataCard
          title={t.symbol}
          right={<PlText value={t.gainLoss}>{money(t.gainLoss)}</PlText>}
        >
          <MetaLine>
            {t.closeDate.slice(0, 10)} · Qty {t.quantity} · {money(t.proceeds)}
          </MetaLine>
          <MetaLine>
            {t.gainLossPercent?.toFixed?.(1) ?? t.gainLossPercent}%
          </MetaLine>
        </DataCard>
      )}
    />
  );
}
