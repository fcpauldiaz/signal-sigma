import { View } from "react-native";
import { DataCard, MetaLine } from "../../src/components/DataCard";
import { ListScreen } from "../../src/components/Screen";
import { StatusDot } from "../../src/components/StatusDot";
import { ErrorText, Muted, ScreenHeader } from "../../src/components/Typography";
import { money } from "../../src/format";
import { useDeskQueries } from "../../src/hooks";
import { space } from "../../src/theme";

export default function OrdersScreen() {
  const { ordersQ } = useDeskQueries();
  const data = ordersQ.data;
  const orders = data?.orders ?? [];
  const eligible = orders.filter((o) => o.eligible).length;

  const onRefresh = () => {
    void ordersQ.refetch();
  };

  if (ordersQ.isError) {
    return (
      <ListScreen
        data={[]}
        keyExtractor={() => "err"}
        renderItem={() => null}
        onRefresh={onRefresh}
        refreshing={ordersQ.isRefetching}
        header={<ErrorText>{(ordersQ.error as Error).message}</ErrorText>}
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
        header={<Muted>Loading orders…</Muted>}
      />
    );
  }

  return (
    <ListScreen
      data={orders}
      keyExtractor={(o) => o.id}
      onRefresh={onRefresh}
      refreshing={ordersQ.isRefetching}
      empty={<Muted>No pending orders.</Muted>}
      header={
        <View style={{ gap: space[16], marginBottom: space[8] }}>
          <ScreenHeader kicker="Open orders" title="Orders">
            BUY only when market ≤ ownership price.
          </ScreenHeader>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[8] }}>
            <StatusDot
              ok={data.quotesOk}
              label={data.quotesOk ? "Quotes ok" : "Quotes down"}
            />
            <Muted>
              {eligible} eligible / {orders.length} pending
            </Muted>
          </View>
          {!data.quotesOk ? <ErrorText>{data.quotesMessage}</ErrorText> : null}
        </View>
      }
      renderItem={({ item: o }) => (
        <DataCard
          title={`${o.direction}  ${o.symbol}`}
          right={
            o.eligible ? (
              <StatusDot ok label="ready" />
            ) : (
              <StatusDot tone="warn" label="no" />
            )
          }
        >
          <MetaLine>
            Qty {o.quantity ?? Math.abs(o.amount)} · {o.strategy || "—"}
          </MetaLine>
          <MetaLine>
            Own {money(o.ownershipPrice)} · SS {money(o.price)} · Mkt{" "}
            {money(o.marketPrice)} · {money(o.value)}
          </MetaLine>
          {!o.eligible && o.skipReason ? (
            <MetaLine>{o.skipReason}</MetaLine>
          ) : null}
        </DataCard>
      )}
    />
  );
}
