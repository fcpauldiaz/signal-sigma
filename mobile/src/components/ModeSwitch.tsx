import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TradingMode } from "../api";
import { colors, fonts, radius, space } from "../theme";

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: TradingMode;
  onChange: (mode: TradingMode) => void;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {(["paper", "live"] as const).map((value) => {
        const active = mode === value;
        return (
          <Pressable
            key={value}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(value);
            }}
            style={[styles.btn, active && styles.active]}
          >
            <Text
              style={[
                styles.label,
                active && (value === "live" ? styles.liveLabel : styles.activeLabel),
              ]}
            >
              {value === "paper" ? "Paper" : "Live"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    gap: 2,
    padding: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
  },
  btn: {
    paddingHorizontal: space[12],
    paddingVertical: space[4],
    borderRadius: radius.pill,
  },
  active: {
    backgroundColor: colors.surface,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
  activeLabel: {
    color: colors.ink,
  },
  liveLabel: {
    color: colors.warning,
  },
});
