import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, space } from "../src/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found", headerShown: true }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn't exist.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to overview</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    padding: space[24],
  },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 20,
    color: colors.ink,
  },
  link: {
    marginTop: space[16],
    paddingVertical: space[16],
  },
  linkText: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.accent,
  },
});
