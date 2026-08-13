import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDeskQueries } from "../hooks";
import { useSession } from "../session";
import { colors, fonts, space } from "../theme";
import { ModeSwitch } from "./ModeSwitch";
import { StatusDot } from "./StatusDot";

export function DeskHeader() {
  const insets = useSafeAreaInsets();
  const { mode, setMode, authEnabled, authenticated, logout } = useSession();
  const { statusQ } = useDeskQueries();
  const job = statusQ.data?.job;
  const jobRunning = job?.status === "running";

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space[8] }]}>
      <View style={styles.row}>
        <Text style={styles.brand}>σ</Text>
        <ModeSwitch mode={mode} onChange={setMode} />
        {jobRunning ? <StatusDot tone="off" label={job.kind} /> : null}
        {authEnabled ? (
          <Pressable
            onPress={() => {
              if (authenticated) {
                void Haptics.selectionAsync();
                void logout();
              }
            }}
            hitSlop={8}
            style={styles.lock}
          >
            <Text style={styles.lockText}>
              {authenticated ? "Lock" : "Unlock"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.paper,
    paddingHorizontal: space[16],
    paddingBottom: space[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[8],
  },
  brand: {
    fontFamily: fonts.monoSemi,
    fontSize: 22,
    color: colors.accent,
    marginRight: space[4],
  },
  lock: {
    marginLeft: "auto",
    paddingHorizontal: space[8],
    paddingVertical: space[4],
  },
  lockText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
});
