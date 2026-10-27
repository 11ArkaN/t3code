import { useActiveNewTask } from "../../state/active-new-task";
import { Toolbar } from "../../components/ui/Toolbar";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { use, useCallback, useEffect, useRef } from "react";
import { isDuoDevice } from "../../lib/device-type";
import { useDeviceType } from "../../native/native-layout-metrics";
import type { SearchBarCommands } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { useSidebarWorkspaceTabs } from "./useSystemWorkspaceTabBar";

const SEARCH_LABELS = {
  threads: "Search threads",
  pullRequests: "Search pull requests",
  settings: "Search settings",
} as const;

/** Search and New thread for the list a workspace screen shows, in that screen's native bars. */
export function WorkspaceToolbar(props: {
  readonly section: keyof typeof SEARCH_LABELS;
  readonly onNewTask: () => void;
  readonly sidebar?: boolean;
}) {
  const workspace = useWorkspaceTabs()!;
  const activeNewTask = useActiveNewTask();
  const deviceType = useDeviceType();
  const duoPortraitSidebar = useSidebarWorkspaceTabs() === "picker";
  const duoSearch = NATIVE_LIQUID_GLASS_SUPPORTED && isDuoDevice(deviceType);
  const bottomSearch = duoSearch && !duoPortraitSidebar;
  const selectedTab = props.section;
  // On the Duo, compose belongs to the thread list, in the detail column's bar when unfolded.
  const nativeToolbarCompose =
    deviceType === "duo-folded" && selectedTab === "threads" && activeNewTask === null;
  const focused = useIsFocused();
  const { panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const searchRef = useRef<SearchBarCommands>(null);
  const tab = workspace.state.tabs[selectedTab];
  const searchLabel = SEARCH_LABELS[selectedTab];
  const foldedSearch = deviceType === "duo-folded";
  const primaryColumn = use(NativePrimaryColumnContext);
  // UIKit hosts integrated search outside the sidebar's sliding content.
  // Mount it after native appearance so it cannot precede the pane's reveal.
  const searchVisible = foldedSearch
    ? tab.searchMode !== "resting"
    : deviceType !== "duo-unfolded" || primaryColumn?.presented !== false;
  const enterSearch = useCallback(() => {
    workspace.dispatch({
      type: "scroll",
      tab: selectedTab,
      offset: workspace.getScrollOffset(selectedTab),
    });
    workspace.dispatch({ type: "search", tab: selectedTab });
    if (props.sidebar && !panes.primarySidebarVisible) togglePrimarySidebar();
  }, [workspace, selectedTab, props.sidebar, panes.primarySidebarVisible, togglePrimarySidebar]);
  // The sidebar remains visible while its detail owns navigation focus.
  const searchHostVisible = focused || primaryColumn?.presented === true;
  const focusSearch = () => {
    // Home stays mounted under a section page pushed over it; that page's search takes the key.
    if (!searchHostVisible) return false;
    if (duoSearch || !NATIVE_LIQUID_GLASS_SUPPORTED) enterSearch();
    searchRef.current?.focus();
    return true;
  };
  const cancelSearch = () => {
    workspace.recordScrollOffset(selectedTab, tab.searchEntryOffset);
    workspace.dispatch({ type: "cancel", tab: selectedTab });
  };
  const searchFocused = () =>
    tab.searchMode === "resting"
      ? enterSearch()
      : workspace.dispatch({ type: "search", tab: selectedTab });
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const restoreSearch = () => {
    if (searchHostVisible && searchVisible && tab.searchMode !== "resting") {
      searchRef.current?.setText(tab.query);
      // Integrated search collapses to its button when its screen reappears,
      // which would hide the query that still filters the list.
      if (NATIVE_LIQUID_GLASS_SUPPORTED) {
        searchRef.current?.setActive(true);
        if (tab.searchMode === "active") searchRef.current?.focus();
      }
    }
  };
  useFocusEffect(
    useCallback(() => {
      const frame = requestAnimationFrame(restoreSearch);
      return () => cancelAnimationFrame(frame);
    }, [restoreSearch]),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- schedules a frame to restore the native search bar's text and focus when it becomes visible or moves to the bottom toolbar
  useEffect(() => {
    const frame = requestAnimationFrame(restoreSearch);
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Moving the search bar to the bottom toolbar restores its focus and query.
  }, [restoreSearch, bottomSearch]);
  const composeButton = nativeToolbarCompose ? (
    <Toolbar.Button
      identifier="workspace-compose"
      accessibilityLabel="New thread"
      icon="square.and.pencil"
      onPress={props.onNewTask}
      separateBackground
    />
  ) : null;
  const searchButton = foldedSearch ? (
    <Toolbar.Button
      identifier="workspace-search"
      accessibilityLabel={searchVisible ? "Close search" : searchLabel}
      icon={searchVisible ? "xmark" : "magnifyingglass"}
      onPress={searchVisible ? () => searchRef.current?.cancelSearch() : focusSearch}
      separateBackground
    />
  ) : null;
  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={[selectedTab, tab.searchMode]}
        listeners={{ transitionEnd: restoreSearch }}
        options={{
          // Without Liquid Glass, Settings keeps its search field out instead of a search button,
          // which would take the header's trailing items from the scope filter.
          headerSearchBarOptions:
            (NATIVE_LIQUID_GLASS_SUPPORTED ||
              tab.searchMode !== "resting" ||
              selectedTab === "settings") &&
            searchVisible
              ? {
                  ref: searchRef,
                  autoFocus: tab.searchMode === "active",
                  autoCapitalize: "none",
                  hideNavigationBar: false,
                  hideWhenScrolling: false,
                  obscureBackground: false,
                  placement: NATIVE_LIQUID_GLASS_SUPPORTED
                    ? bottomSearch
                      ? "integrated"
                      : "integratedButton"
                    : "stacked",
                  allowToolbarIntegration:
                    NATIVE_LIQUID_GLASS_SUPPORTED && deviceType !== "phone" && !duoPortraitSidebar,
                  placeholder: searchLabel,
                  cancelButtonHidden: foldedSearch,
                  onFocus: searchFocused,
                  onBlur: () => workspace.dispatch({ type: "expand", tab: selectedTab }),
                  onSearchButtonPress: () => searchRef.current?.blur(),
                  onChangeText: ({ nativeEvent }) =>
                    workspace.dispatch({
                      type: "query",
                      query: nativeEvent.text,
                      tab: selectedTab,
                    }),
                  onCancelButtonPress: cancelSearch,
                }
              : undefined,
        }}
      />
      {/* UIKit lays trailing items out from the edge inward. A trailing toolbar replaces the
          header's own items, so an empty one would hide the Settings scope filter. */}
      {selectedTab === "settings" && !foldedSearch ? null : (
        <Toolbar placement="right">
          {searchButton}
          {nativeToolbarCompose && foldedSearch ? <Toolbar.Spacer width={8} /> : null}
          {composeButton}
          {selectedTab === "threads" && !isDuoDevice(deviceType) ? (
            <Toolbar.Button
              accessibilityLabel="New thread"
              icon="square.and.pencil"
              onPress={props.onNewTask}
            />
          ) : null}
          {NATIVE_LIQUID_GLASS_SUPPORTED ? null : (
            <Toolbar.Button
              accessibilityLabel={searchLabel}
              icon="magnifyingglass"
              onPress={focusSearch}
            />
          )}
        </Toolbar>
      )}
      <Toolbar placement="bottom">
        {bottomSearch && searchVisible ? <Toolbar.SearchBarSlot /> : null}
      </Toolbar>
    </>
  );
}
