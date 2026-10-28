import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { CHROME_MAX_FONT_SCALE } from "../../lib/layout";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** The footer row's height above its bottom inset. */
export const WORKSPACE_SIDEBAR_FOOTER_HEIGHT = 48;
// The row's horizontal padding (px-2), and the least space kept between neighboring labels.
const FOOTER_ROW_PADDING = 14;
const FOOTER_LABEL_GAP = 16;

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

/** Item content widths the footer measured, by tab. They do not depend on where it renders. */
export type WorkspaceSidebarFooterWidths = Readonly<Partial<Record<FooterItem["tab"], number>>>;

/** Whether the utility items, at their measured widths, share one row of a column this wide. */
export function workspaceSidebarFooterFits(
  widths: WorkspaceSidebarFooterWidths,
  columnWidth: number,
): boolean {
  const total = UTILITY_ITEMS.reduce((sum, item) => sum + (widths[item.tab] ?? 0), 0);
  return total + FOOTER_LABEL_GAP * (UTILITY_ITEMS.length - 1) <= columnWidth - FOOTER_ROW_PADDING;
}

/**
 * The iOS thread list's footer, as on desktop: its utility sections, or Back from one of them.
 * Fixed under the list while its items share one row; otherwise the list's last content, with
 * the items stacked.
 */
export function WorkspaceSidebarFooter(props: {
  readonly back: boolean;
  readonly placement: "fixed" | "list";
  readonly bottomInset: number;
  readonly surfaceClassName: string;
  readonly widths: WorkspaceSidebarFooterWidths;
  readonly onMeasureItem: (tab: FooterItem["tab"], width: number) => void;
  readonly onSelect: (tab: WorkspaceTab | "settings") => void;
}) {
  const fixed = props.placement === "fixed";
  const items = props.back ? [BACK] : UTILITY_ITEMS;
  return (
    <View
      className={cn(
        "border-t border-border px-2",
        fixed ? "absolute inset-x-0 bottom-0 flex-row" : "mt-4 py-1",
        props.surfaceClassName,
      )}
      style={fixed ? { paddingBottom: props.bottomInset } : undefined}
    >
      {items.map((item) => (
        <RowPressable
          key={item.tab}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          className={cn(
            "flex-row items-center rounded-lg active:opacity-70",
            !fixed
              ? "justify-start px-3"
              : props.back
                ? "flex-1 justify-start px-3"
                : "flex-1 justify-center",
          )}
          // Equal thirds until a label outgrows its share; then it keeps its measured width.
          style={{
            height: WORKSPACE_SIDEBAR_FOOTER_HEIGHT,
            minWidth: fixed ? props.widths[item.tab] : undefined,
          }}
          onPress={() => props.onSelect(item.tab)}
        >
          <View
            className="shrink-0 flex-row items-center gap-2"
            onLayout={(event) => props.onMeasureItem(item.tab, event.nativeEvent.layout.width)}
          >
            <SymbolView name={item.icon} size={17} tintColorClassName="accent-icon" />
            <Text
              className="text-sm font-t3-medium text-foreground-muted"
              numberOfLines={1}
              maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
            >
              {item.label}
            </Text>
          </View>
        </RowPressable>
      ))}
    </View>
  );
}
