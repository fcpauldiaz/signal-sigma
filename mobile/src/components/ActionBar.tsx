import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import {
  runPlaceOrders,
  runRebalance,
  runRebalanceAndPlace,
  updateExecution,
} from "../api";
import { useDeskQueries, useInvalidateDesk } from "../hooks";
import { useSession } from "../session";
import { colors, fonts, radius, space } from "../theme";
import { PressableScale } from "./PressableScale";
import { StatusDot } from "./StatusDot";

export function ActionBar() {
  const { mode, authenticated } = useSession();
  const { statusQ } = useDeskQueries();
  const invalidateAll = useInvalidateDesk();
  const qc = useQueryClient();

  const rebalanceMut = useMutation({
    mutationFn: runRebalance,
    onSuccess: invalidateAll,
  });
  const placeMut = useMutation({
    mutationFn: runPlaceOrders,
    onSuccess: invalidateAll,
  });
  const bothMut = useMutation({
    mutationFn: runRebalanceAndPlace,
    onSuccess: invalidateAll,
  });
  const executionMut = useMutation({
    mutationFn: updateExecution,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const jobRunning = statusQ.data?.job?.status === "running";
  const canAct = authenticated && !jobRunning;
  const executionEnabled =
    mode === "live"
      ? Boolean(statusQ.data?.execution?.live)
      : Boolean(statusQ.data?.execution?.paper);
  const canPlace = canAct && executionEnabled;

  const runLiveGuarded = (label: string, fn: () => void) => {
    if (mode !== "live") {
      fn();
      return;
    }
    Alert.alert("Live account", `Run ${label} on the live account?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Run", style: "destructive", onPress: fn },
    ]);
  };

  const error =
    (rebalanceMut.error ||
      placeMut.error ||
      bothMut.error ||
      executionMut.error) as Error | null;

  return (
    <View style={styles.wrap}>
      <View style={styles.toggles}>
        <View style={styles.toggle}>
          <Switch
            value={Boolean(statusQ.data?.execution?.paper)}
            disabled={!authenticated || executionMut.isPending}
            onValueChange={(paper) => executionMut.mutate({ paper })}
            trackColor={{ false: colors.rule, true: colors.accent }}
            thumbColor={colors.ink}
          />
          <Text style={styles.toggleLabel}>Paper exec</Text>
        </View>
        <View style={styles.toggle}>
          <Switch
            value={Boolean(statusQ.data?.execution?.live)}
            disabled={!authenticated || executionMut.isPending}
            onValueChange={(live) => {
              if (live) {
                Alert.alert("Live execution", "Enable live order execution?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Enable",
                    style: "destructive",
                    onPress: () => executionMut.mutate({ live }),
                  },
                ]);
                return;
              }
              executionMut.mutate({ live });
            }}
            trackColor={{ false: colors.rule, true: colors.warning }}
            thumbColor={colors.ink}
          />
          <Text style={[styles.toggleLabel, styles.liveLabel]}>Live exec</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <ToolButton
          label={rebalanceMut.isPending ? "Rebalancing" : "Rebalance"}
          disabled={!canAct || rebalanceMut.isPending}
          onPress={() => rebalanceMut.mutate()}
        />
        <ToolButton
          label={placeMut.isPending ? "Placing" : "Place orders"}
          disabled={!canPlace || placeMut.isPending}
          onPress={() =>
            runLiveGuarded("place orders", () => placeMut.mutate())
          }
        />
        <ToolButton
          label={bothMut.isPending ? "Running" : "Rebalance + place"}
          disabled={!canPlace || bothMut.isPending}
          onPress={() =>
            runLiveGuarded("rebalance + place", () => bothMut.mutate())
          }
        />
      </View>

      {!executionEnabled && (
        <StatusDot tone="warn" label={`${mode} execution off`} />
      )}
      {error && <Text style={styles.error}>{error.message}</Text>}
    </View>
  );
}

function ToolButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[12],
  },
  toggles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[16],
    alignItems: "center",
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[8],
  },
  toggleLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
  },
  liveLabel: {
    color: colors.warning,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[8],
  },
  button: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.sm,
    paddingHorizontal: space[12],
    paddingVertical: space[8],
  },
  buttonText: {
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.negative,
  },
});
