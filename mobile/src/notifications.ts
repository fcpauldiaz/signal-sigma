import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Href, router } from "expo-router";
import { Platform } from "react-native";
import { registerPushToken } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId
  );
}

function hrefFromData(data: Record<string, unknown> | undefined): Href | null {
  const href = data?.href;
  return typeof href === "string" ? (href as Href) : null;
}

export async function registerDeskPush(): Promise<void> {
  if (Platform.OS === "web") return;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("desk", {
      name: "Desk",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const id = projectId();
  if (!id) return;

  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await registerPushToken(token.data);
}

export function listenForNotificationTaps(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const href = hrefFromData(
        response.notification.request.content.data as
          | Record<string, unknown>
          | undefined
      );
      if (href) router.push(href);
    }
  );
  return () => sub.remove();
}
