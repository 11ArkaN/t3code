import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { RowPressable } from "../../components/ui/RowPressable";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** The footer's height above its bottom inset. */
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

/** The iOS thread list's footer, as on desktop: its utility sections, or Back from one of them. */
export function WorkspaceSidebarFooter(props: {
  readonly back: boolean;
  readonly bottomInset: number;
  readonly surfaceClassName: string;
  readonly onSelect: (tab: WorkspaceTab | "settings") => void;
}) {
  const items = props.back ? [BACK] : UTILITY_ITEMS;
  return (
    <View
      className={`absolute inset-x-0 bottom-0 flex-row border-t border-border px-2 ${props.surfaceClassName}`}
      style={{ paddingBottom: props.bottomInset }}
    >
      {items.map((item) => (
        <RowPressable
          key={item.tab}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          className={`flex-1 flex-row items-center gap-2 rounded-lg active:opacity-70 ${props.back ? "justify-start px-3" : "justify-center"}`}
          style={{ height: WORKSPACE_SIDEBAR_FOOTER_HEIGHT }}
          onPress={() => props.onSelect(item.tab)}
        >
          <SymbolView name={item.icon} size={17} tintColorClassName="accent-icon" />
          <Text className="text-sm font-t3-medium text-foreground-muted" numberOfLines={1}>
            {item.label}
          </Text>
        </RowPressable>
      ))}
    </View>
  );
}
