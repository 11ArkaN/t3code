import {
  NAVIGATION_TAB_ORDER,
  navigationCustomizationAvailable,
  resolveNavigationTabOrder,
  type NavigationTab,
} from "./navigation-tab-order";

export function resolveWorkspaceTabOrder(platform: string, saved: readonly unknown[] | undefined) {
  return navigationCustomizationAvailable(platform)
    ? resolveNavigationTabOrder(saved)
    : NAVIGATION_TAB_ORDER;
}

export type WorkspaceTab = NavigationTab;
/** Lists with their own search: the searchable tabs and the Settings list. */
export type WorkspaceSearchTab = WorkspaceTab | "settings";
export type WorkspaceSearchMode = "resting" | "active" | "expanded";

export interface WorkspaceTabState {
  readonly query: string;
  readonly searchMode: WorkspaceSearchMode;
  readonly scrollOffset: number;
  readonly searchEntryOffset: number;
}

export interface WorkspaceTabsState {
  readonly selectedTab: WorkspaceTab;
  readonly tabs: Readonly<Record<WorkspaceSearchTab, WorkspaceTabState>>;
}

function emptyTab(): WorkspaceTabState {
  return { query: "", searchMode: "resting", scrollOffset: 0, searchEntryOffset: 0 };
}

export function initialWorkspaceTabsState(): WorkspaceTabsState {
  return {
    selectedTab: "threads",
    tabs: {
      threads: emptyTab(),
      pullRequests: emptyTab(),
      usage: emptyTab(),
      settings: emptyTab(),
    },
  };
}

export type WorkspaceTabsAction =
  | { readonly type: "select"; readonly tab: WorkspaceTab }
  | { readonly type: "search"; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "query"; readonly query: string; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "expand"; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "cancel"; readonly tab?: WorkspaceSearchTab }
  | { readonly type: "scroll"; readonly tab: WorkspaceSearchTab; readonly offset: number };

export function workspaceTabsReducer(
  state: WorkspaceTabsState,
  action: WorkspaceTabsAction,
): WorkspaceTabsState {
  if (action.type === "select")
    return action.tab === state.selectedTab ? state : { ...state, selectedTab: action.tab };
  const tab = action.tab ?? state.selectedTab;
  if (tab !== "threads" && tab !== "pullRequests" && tab !== "settings") return state;
  const current = state.tabs[tab];
  let next: WorkspaceTabState;
  switch (action.type) {
    case "search":
      next = {
        ...current,
        searchMode: "active",
        searchEntryOffset:
          current.searchMode === "resting" ? current.scrollOffset : current.searchEntryOffset,
      };
      break;
    case "query":
      next = { ...current, query: action.query };
      break;
    case "expand":
      if (current.searchMode === "resting") return state;
      next = { ...current, searchMode: "expanded" };
      break;
    case "cancel":
      next = {
        ...current,
        query: "",
        searchMode: "resting",
        scrollOffset: current.searchEntryOffset,
      };
      break;
    case "scroll":
      if (current.scrollOffset === action.offset) return state;
      next = { ...current, scrollOffset: action.offset };
      break;
  }
  return { ...state, tabs: { ...state.tabs, [tab]: next } };
}
