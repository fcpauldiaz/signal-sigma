import { Redirect, router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "../src/components/PressableScale";
import { useSession } from "../src/session";
import { colors, fonts, radius, space } from "../src/theme";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { ready, needsLogin, login } = useSession();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await login(password);
      router.replace("/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  if (!ready) return null;
  if (!needsLogin) return <Redirect href="/(tabs)" />;

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.inner, { paddingTop: insets.top + space[48] }]}>
        <Text style={styles.mark}>σ</Text>
        <Text style={styles.kicker}>Signal Sigma</Text>
        <Text style={styles.title}>Unlock desk</Text>
        <Text style={styles.copy}>Password required to view and trade.</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.faint}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, focused && styles.inputFocus]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => {
            if (password && !pending) void submit();
          }}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PressableScale
          style={styles.button}
          disabled={!password || pending}
          onPress={() => void submit()}
        >
          <Text style={styles.buttonText}>{pending ? "Unlocking" : "Unlock"}</Text>
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  inner: {
    paddingHorizontal: space[24],
    gap: space[12],
  },
  mark: {
    fontFamily: fonts.monoSemi,
    fontSize: 42,
    color: colors.accent,
  },
  kicker: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 32,
    color: colors.ink,
    letterSpacing: -0.4,
  },
  copy: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    maxWidth: 320,
  },
  input: {
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.sm,
    paddingHorizontal: space[12],
    paddingVertical: space[12],
    marginTop: space[8],
  },
  inputFocus: {
    borderColor: colors.accent,
  },
  error: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.negative,
  },
  button: {
    backgroundColor: colors.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.sm,
    paddingVertical: space[12],
    alignItems: "center",
    marginTop: space[4],
  },
  buttonText: {
    fontFamily: fonts.monoMedium,
    fontSize: 13,
    color: colors.ink,
  },
});
