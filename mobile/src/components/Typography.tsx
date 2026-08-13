import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, space } from "../theme";

export function ScreenHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <View>
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.copy}>{children}</Text>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

export function PlText({
  value,
  children,
}: {
  value: number | null | undefined;
  children: ReactNode;
}) {
  const tone =
    value == null || value === 0 ? "" : value > 0 ? "pos" : "neg";
  return (
    <Text
      style={[
        styles.pl,
        tone === "pos" && styles.pos,
        tone === "neg" && styles.neg,
      ]}
    >
      {children}
    </Text>
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
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 28,
    color: colors.ink,
    marginTop: space[4],
  },
  copy: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    marginTop: space[8],
  },
  muted: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.muted,
  },
  error: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.negative,
  },
  pl: {
    fontFamily: fonts.monoSemi,
    fontSize: 14,
    color: colors.ink,
  },
  pos: { color: colors.positive },
  neg: { color: colors.negative },
});
