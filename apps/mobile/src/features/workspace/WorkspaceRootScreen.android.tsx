import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { useEnabledNavigationTabs } from "./navigation-tabs";
import { NAVIGATION_TAB_ORDER } from "./navigation-tab-order";
import { WorkspaceExtraTab } from "./WorkspaceExtraTab";
import { useMemo } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { PullRequestFilterMenuProvider } from "../pull-requests/PullRequestFilterMenuContext";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { PullRequestToolbar } from "../pull-requests/PullRequestToolbar.android";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { AndroidWorkspaceNavigation } from "./AndroidWorkspaceNavigation";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";
import type { WorkspaceTab } from "./workspace-tabs-state";

const TABS: readonly WorkspaceTab[] = NAVIGATION_TAB_ORDER;

export function WorkspaceRootScreen() {
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs()!;
  const enabled = useEnabledNavigationTabs();
  const insets = useSafeAreaInsets();
  const { fabClearance } = useAndroidControlSizing();
  const context = useMemo(
    () => ({
      ...workspace,
      bottomClearance: layout.usesSplitView
        ? workspace.bottomClearance
        : workspace.state.selectedTab === "threads"
          ? fabClearance + 16
          : 16,
    }),
    [workspace, fabClearance, layout.usesSplitView],
  );
  const tab = workspace.state.selectedTab;

  return (
    <WorkspaceTabsContext value={context}>
      <View className={layout.usesSplitView ? "flex-1 bg-screen" : "flex-1 bg-header"}>
        {!layout.usesSplitView ? (
          <NativeStackScreenOptions options={{ headerShown: false }} />
        ) : null}
        <SafeAreaInsetsContext value={layout.usesSplitView ? insets : { ...insets, bottom: 0 }}>
          {enabled.length === 0 ? (
            layout.usesSplitView ? (
              <View className="flex-1 bg-screen" />
            ) : (
              <WorkspaceNoTabs />
            )
          ) : (
            <WorkspaceTabPanes
              tabs={TABS}
              selected={tab}
              renderTab={(tab) =>
                tab === "threads" ? (
                  <HomeRouteScreen />
                ) : tab !== "pullRequests" ? (
                  <WorkspaceExtraTab tab={tab} />
                ) : layout.usesSplitView ? (
                  <>
                    <NativeStackScreenOptions options={{ headerShown: false }} />
                    <AndroidScreenHeader title="Pull requests" />
                    <View className="flex-1 items-center justify-center px-10">
                      <EmptyState
                        title="Select a pull request"
                        detail="Choose a pull request from the sidebar to review it."
                        variant="plain"
                      />
                    </View>
                  </>
                ) : (
                  <PullRequestFilterMenuProvider>
                    <PullRequestToolbar />
                    <ScreenContent>
                      <PullRequestsScreen />
                    </ScreenContent>
                  </PullRequestFilterMenuProvider>
                )
              }
            />
          )}
        </SafeAreaInsetsContext>
        {!layout.usesSplitView ? <AndroidWorkspaceNavigation onNewThread={startNewTask} /> : null}
      </View>
    </WorkspaceTabsContext>
  );
}
