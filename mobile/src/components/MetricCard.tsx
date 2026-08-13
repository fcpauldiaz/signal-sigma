import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space } from "../theme";

export function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "";
}) {
  const resolved = tone ?? "";
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          resolved === "pos" && styles.pos,
          resolved === "neg" && styles.neg,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[12],
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.rule,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[16],
    width: "47.5%",
    flexGrow: 1,
    minWidth: 140,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.faint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: space[8],
  },
  value: {
    fontFamily: fonts.monoMedium,
    fontSize: 18,
    color: colors.ink,
  },
  pos: { color: colors.positive },
  neg: { color: colors.negative },
});
