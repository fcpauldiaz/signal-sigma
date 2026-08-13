import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, space } from "../theme";

export function DataCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function MetaLine({ children }: { children: ReactNode }) {
  return <Text style={styles.meta}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    paddingVertical: space[12],
    gap: space[4],
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[8],
  },
  title: {
    fontFamily: fonts.monoSemi,
    fontSize: 15,
    color: colors.ink,
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
});
