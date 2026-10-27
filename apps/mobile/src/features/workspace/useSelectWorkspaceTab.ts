import { Keyboard, Platform } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

/**
 * Opens a workspace tab, Settings included, from a footer, rail, toolbar or command. iOS opens
 * Usage as a page, so it never becomes the list Home shows.
 */
export function useSelectWorkspaceTab() {
  const dispatch = useWorkspaceTabs()?.dispatch;
  const { openWorkspaceTab } = useAdaptiveWorkspaceLayout();
  return (tab: WorkspaceTab | "settings") => {
    Keyboard.dismiss();
    openWorkspaceTab(tab);
    if (tab === "settings" || (Platform.OS === "ios" && tab === "usage")) return;
    dispatch?.({ type: "select", tab });
  };
}
