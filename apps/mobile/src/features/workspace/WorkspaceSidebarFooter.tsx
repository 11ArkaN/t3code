import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { useLargeText } from "../../lib/useLargeText";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** The footer row's height above its bottom inset, and each stacked item's minimum. */
export const WORKSPACE_SIDEBAR_FOOTER_HEIGHT = 48;

type FooterItem = {
  readonly tab: WorkspaceTab | "settings";
  readonly label: string;
  readonly icon: AppSymbolName;
};

const UTILITY_ITEMS: readonly FooterItem[] = [
  { tab: "settings", label: "Settings", icon: "gearshape" },
  { tab: "pullRequests", label: "Pull requests", icon: PullRequestGlyph.pullRequest },
  { tab: "usage", label: "Usage", icon: "chart.bar.xaxis" },
];

const BACK: FooterItem = { tab: "threads", label: "Back", icon: "arrow.left" };

/**
 * The iOS thread list's footer, as on desktop: its utility sections, or Back from one of them.
 * Accessibility text sizes stack the items so each label keeps its full width.
 */
export function WorkspaceSidebarFooter(props: {
  readonly back: boolean;
  readonly bottomInset: number;
  readonly surfaceClassName: string;
  readonly onSelect: (tab: WorkspaceTab | "settings") => void;
  /** Reports the footer's height above the bottom inset while its items stack. */
  readonly onStackedHeightChange: (height: number) => void;
}) {
  const stacked = useLargeText();
  const items = props.back ? [BACK] : UTILITY_ITEMS;
  return (
    <View
      className={cn(
        "absolute inset-x-0 bottom-0 border-t border-border px-2",
        !stacked && "flex-row",
        props.surfaceClassName,
      )}
      style={{ paddingBottom: props.bottomInset }}
      onLayout={
        stacked
          ? (event) =>
              props.onStackedHeightChange(event.nativeEvent.layout.height - props.bottomInset)
          : undefined
      }
    >
      {items.map((item) => (
        <RowPressable
          key={item.tab}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          className={cn(
            "flex-row items-center gap-2 rounded-lg active:opacity-70",
            stacked
              ? "justify-start px-3 py-1.5"
              : props.back
                ? "flex-1 justify-start px-3"
                : "flex-1 justify-center",
          )}
          style={
            stacked
              ? { minHeight: WORKSPACE_SIDEBAR_FOOTER_HEIGHT }
              : { height: WORKSPACE_SIDEBAR_FOOTER_HEIGHT }
          }
          onPress={() => props.onSelect(item.tab)}
        >
          <SymbolView name={item.icon} size={17} tintColorClassName="accent-icon" />
          <Text
            className={cn("text-sm font-t3-medium text-foreground-muted", stacked && "shrink")}
            numberOfLines={stacked ? undefined : 1}
          >
            {item.label}
          </Text>
        </RowPressable>
      ))}
    </View>
  );
}
