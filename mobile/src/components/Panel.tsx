import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space } from "../theme";

export function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {typeof meta === "string" ? (
          <Text style={styles.meta}>{meta}</Text>
        ) : (
          meta
        )}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.rule,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space[16],
    gap: space[12],
  },
  head: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[8],
  },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.ink,
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
});
