import { type ReactNode } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  type ListRenderItem,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, space } from "../theme";

export function Screen({
  children,
  onRefresh,
  refreshing,
  contentStyle,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl(onRefresh, refreshing)}
    >
      {children}
    </ScrollView>
  );
}

export function ListScreen<T>({
  data,
  keyExtractor,
  renderItem,
  header,
  empty,
  onRefresh,
  refreshing,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: ListRenderItem<T>;
  header?: ReactNode;
  empty?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <FlatList
      style={styles.scroll}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={header ? <>{header}</> : null}
      ListEmptyComponent={empty ? <>{empty}</> : null}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl(onRefresh, refreshing)}
    />
  );
}

function refreshControl(onRefresh?: () => void, refreshing?: boolean) {
  if (!onRefresh) return undefined;
  return (
    <RefreshControl
      refreshing={Boolean(refreshing)}
      onRefresh={onRefresh}
      tintColor={colors.accent}
    />
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    padding: space[16],
    paddingBottom: space[48],
    gap: space[16],
  },
  listContent: {
    padding: space[16],
    paddingBottom: space[48],
  },
});
