import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space } from "../theme";

export function StatusDot({
  ok,
  label,
  tone,
}: {
  ok?: boolean;
  label: string;
  tone?: "ok" | "warn" | "off";
}) {
  const resolved: "ok" | "warn" | "off" =
    tone ?? (ok ? "ok" : "off");
  return (
    <View
      style={[
        styles.pill,
        resolved === "ok" && styles.ok,
        resolved === "warn" && styles.warn,
        resolved === "off" && styles.off,
      ]}
    >
      <Text
        style={[
          styles.text,
          resolved === "ok" && styles.okText,
          resolved === "warn" && styles.warnText,
          resolved === "off" && styles.offText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: space[8],
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  ok: { backgroundColor: colors.accentMuted },
  warn: { backgroundColor: colors.warningMuted },
  off: { backgroundColor: colors.elevated },
  text: {
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  okText: { color: colors.positive },
  warnText: { color: colors.warning },
  offText: { color: colors.faint },
});
