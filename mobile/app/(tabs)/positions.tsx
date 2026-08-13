import { StyleSheet, Text, View } from "react-native";
import type { PositionsResponse } from "../../src/api";
import { DataCard, MetaLine } from "../../src/components/DataCard";
import { MetricCard, MetricGrid } from "../../src/components/MetricCard";
import { ListScreen } from "../../src/components/Screen";
import {
  ErrorText,
  Muted,
  PlText,
  ScreenHeader,
} from "../../src/components/Typography";
import { money, plClass } from "../../src/format";
import { useDeskQueries } from "../../src/hooks";
import { colors, fonts, space } from "../../src/theme";

type Broker = PositionsResponse["brokerPositions"][number];
type Signal = PositionsResponse["signalPositions"][number];
type Row =
  | { kind: "head"; id: string; title: string; meta: string }
  | { kind: "broker"; id: string; payload: Broker }
  | { kind: "signal"; id: string; payload: Signal };

export default function PositionsScreen() {
  const { positionsQ } = useDeskQueries();
  const data = positionsQ.data;

  const onRefresh = () => {
    void positionsQ.refetch();
  };

  if (positionsQ.isError) {
    return (
      <ListScreen
        data={[]}
        keyExtractor={() => "err"}
        renderItem={() => null}
        onRefresh={onRefresh}
        refreshing={positionsQ.isRefetching}
        header={<ErrorText>{(positionsQ.error as Error).message}</ErrorText>}
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
        header={<Muted>Loading positions…</Muted>}
      />
    );
  }

  const rows: Row[] = [
    {
      kind: "head",
      id: "head-broker",
      title: "Broker",
      meta: `${data.brokerPositions.length} symbols`,
    },
    ...data.brokerPositions.map((p) => ({
      kind: "broker" as const,
      id: `b-${p.symbol}`,
      payload: p,
    })),
    {
      kind: "head",
      id: "head-signal",
      title: "Signal Sigma book",
      meta: `${data.signalPositions.length} · ${money(data.signalPortfolioValue)}`,
    },
    ...data.signalPositions.map((t) => ({
      kind: "signal" as const,
      id: `s-${t.symbol}`,
      payload: t,
    })),
  ];

  return (
    <ListScreen
      data={rows}
      keyExtractor={(item) => item.id}
      onRefresh={onRefresh}
      refreshing={positionsQ.isRefetching}
      header={
        <View style={{ gap: space[16], marginBottom: space[8] }}>
          <ScreenHeader kicker="Broker · Signal Sigma" title="Positions">
            {data.mode} · {data.accountId}
          </ScreenHeader>
          <MetricGrid>
            <MetricCard
              label="Equity"
              value={money(data.balances.totalEquity)}
            />
            <MetricCard label="Cash" value={money(data.balances.totalCash)} />
            <MetricCard
              label="Market value"
              value={money(data.balances.marketValue)}
            />
            <MetricCard
              label="Open P&L"
              value={money(data.balances.openPl)}
              tone={plClass(data.balances.openPl)}
            />
          </MetricGrid>
        </View>
      }
      renderItem={({ item }) => {
        if (item.kind === "head") {
          return (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingTop: space[20],
                paddingBottom: space[8],
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.sansMedium,
                  fontSize: 16,
                  color: colors.ink,
                }}
              >
                {item.title}
              </Text>
              <Muted>{item.meta}</Muted>
            </View>
          );
        }
        if (item.kind === "broker") {
          const p = item.payload;
          return (
            <DataCard
              title={p.symbol}
              right={<PlText value={p.openPl}>{money(p.openPl)}</PlText>}
            >
              <MetaLine>
                Qty {p.quantity} · Avg {money(p.avgCost)} · Last{" "}
                {money(p.lastPrice)}
              </MetaLine>
              <MetaLine>
                Mkt {money(p.marketValue)} ·{" "}
                {p.openPlPercent == null ? "—" : `${p.openPlPercent.toFixed(1)}%`}
                {p.dateAcquired ? ` · ${p.dateAcquired.slice(0, 10)}` : ""}
              </MetaLine>
            </DataCard>
          );
        }
        const t = item.payload;
        return (
          <DataCard
            title={t.symbol}
            right={<Muted>{t.percent?.toFixed?.(1) ?? t.percent}%</Muted>}
          >
            <MetaLine>
              {t.strategy || "—"} · {t.amount} / {t.targetAmount} sh
            </MetaLine>
            <MetaLine>
              Own {money(t.ownershipPrice)} · Last {money(t.lastPrice)} ·{" "}
              {money(t.value)}
            </MetaLine>
          </DataCard>
        );
      }}
    />
  );
}
