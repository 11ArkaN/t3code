import { useNavigation, useRoute } from "@react-navigation/native";
import { use } from "react";
import { View, useWindowDimensions } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { HeaderItemsWidthContext } from "../../native/header-items-width";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import {
  useDeviceType,
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { WorkspaceConnectionTitle } from "../home/WorkspaceConnectionTitle";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { SettingsRouteScreen } from "../settings/SettingsRouteScreen";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { useSidebarWorkspaceTabs } from "./useSystemWorkspaceTabBar";
import { useWorkspaceSurface } from "./useWorkspaceSurface";
import { WORKSPACE_SIDEBAR_FOOTER_HEIGHT, WorkspaceSidebarFooter } from "./WorkspaceSidebarFooter";
import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceToolbar } from "./WorkspaceToolbar.ios";

const SECTION_TITLES = {
  threads: "Threads",
  pullRequests: "Pull requests",
  settings: "Settings",
} as const;

type WorkspaceSection = keyof typeof SECTION_TITLES;

function WorkspaceRootTitle(props: {
  readonly columnWidth: number;
  readonly section: WorkspaceSection;
  readonly onOpenEnvironments: () => void;
}) {
  const maxWidth = Math.max(0, props.columnWidth - (use(HeaderItemsWidthContext) ?? 160));
  return (
    <View style={{ width: maxWidth, minHeight: 32, justifyContent: "center" }}>
      <WorkspaceConnectionTitle
        brand={
          <CompactBrandTitle accessibilityLabel={`T3 Code, ${SECTION_TITLES[props.section]}`} fit />
        }
        maxWidth={maxWidth}
        onPress={props.onOpenEnvironments}
      />
    </View>
  );
}

/**
 * The iOS workspace list, laid out like the desktop sidebar. Home shows threads, or beside a
 * detail column the section its footer opened. Without columns, Pull requests and Settings are
 * pages pushed above Home; their routes render this screen with that section.
 */
export function WorkspaceRootScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const { width: windowWidth } = useWindowDimensions();
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const primaryColumn = use(NativePrimaryColumnContext);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const nativeMetrics = useNativeLayoutMetrics();
  const deviceType = useDeviceType();
  const surface = useWorkspaceSurface();
  const duoPortraitSidebar = useSidebarWorkspaceTabs() === "picker";
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((keyboard) => keyboard.height);
  const workspace = useWorkspaceTabs()!;
  const page =
    route.name === "Settings" ? "settings" : route.name === "PullRequests" ? "pullRequests" : null;
  const section: WorkspaceSection =
    page ??
    (!layout.usesSplitView
      ? "threads"
      : workspace.settingsOpen
        ? "settings"
        : workspace.state.selectedTab === "pullRequests"
          ? "pullRequests"
          : "threads");
  const sidebarNavigation =
    primaryColumn !== null &&
    (layout.usesSplitView ||
      deviceType === "pad" ||
      (nativeMetrics !== null && nativeMetrics.verticalBarEdge !== "none"));
  const drawer =
    page === null && (duoPortraitSidebar || (deviceType === "pad" && layout.usesSplitView));
  const surfaceClassName = drawer ? "bg-drawer" : surface.className;
  const width = columnMetrics?.width ?? windowWidth;
  // UIKit insets a column's lists by the column's safe area, which this context can report as 0.
  const bottomInset = Math.max(insets.bottom, columnMetrics?.safeArea.bottom ?? 0);
  // The soft keyboard covers the footer, so it steps aside while typing.
  const footer = page === null && keyboardHeight === 0;
  const bottomClearance =
    Math.max(bottomInset, keyboardHeight) + (footer ? WORKSPACE_SIDEBAR_FOOTER_HEIGHT : 0) + 16;
  const renderHeaderTitle = () => (
    <WorkspaceRootTitle
      columnWidth={width}
      section={section}
      onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
    />
  );
  const context = { ...workspace, bottomClearance };

  return (
    <WorkspaceTabsContext value={context}>
      <View
        className={`flex-1 ${surfaceClassName}`}
        style={drawer ? { paddingTop: insets.top } : undefined}
      >
        {page === null ? (
          <NativeStackScreenOptions
            optionsVersion={[section, width]}
            options={{
              title: SECTION_TITLES[section],
              headerShown: true,
              headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
              headerStyle: NATIVE_LIQUID_GLASS_SUPPORTED
                ? { backgroundColor: "transparent" }
                : undefined,
              contentStyle: undefined,
              unstable_headerLeftItems: () => [],
              headerTitle: renderHeaderTitle,
            }}
          />
        ) : null}
        <SafeAreaInsetsContext value={drawer ? { ...insets, top: 0 } : insets}>
          {section === "settings" ? (
            <SettingsRouteScreen />
          ) : section === "pullRequests" ? (
            <PullRequestsScreen />
          ) : (
            <HomeRouteScreen />
          )}
        </SafeAreaInsetsContext>
        <WorkspaceToolbar section={section} sidebar={sidebarNavigation} onNewTask={startNewTask} />
        {footer ? (
          <WorkspaceSidebarFooter
            back={section !== "threads"}
            bottomInset={bottomInset}
            surfaceClassName={surfaceClassName}
            onSelect={selectTab}
          />
        ) : null}
      </View>
    </WorkspaceTabsContext>
  );
}
