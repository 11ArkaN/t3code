import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { VcsStatusResult } from "@t3tools/contracts";

import {
  presentThreadLinkedPullRequests,
  presentThreadPr,
  type ThreadPrPresentation,
} from "../../state/thread-pr-presentation";

/** Desktop's right panel surfaces, in its order (apps/web/src/components/RightPanelTabs.tsx). */
const THREAD_PANEL_TABS = [
  "browser",
  "terminal",
  "files",
  "diff",
  "pull-request",
  "device",
] as const;
export type ThreadPanelTab = (typeof THREAD_PANEL_TABS)[number];

export const THREAD_PANEL_TAB_LABELS: Record<ThreadPanelTab, string> = {
  browser: "Browser",
  terminal: "Terminal",
  files: "Files",
  diff: "Diff",
  "pull-request": "Pull request",
  device: "Device",
};

export type ThreadPanelPresentation = "sheet" | "column";

// The other tabs open their existing full screen, which cannot live inside the panel.
const TABS_SHOWN_IN_PANEL: Record<ThreadPanelPresentation, ReadonlySet<ThreadPanelTab>> = {
  sheet: new Set(["terminal", "files"]),
  column: new Set(["terminal", "files", "device"]),
};

export function threadPanelShowsTab(tab: ThreadPanelTab, presentation: ThreadPanelPresentation) {
  return TABS_SHOWN_IN_PANEL[presentation].has(tab);
}

export function threadPanelTabs(available: Readonly<Record<ThreadPanelTab, boolean>>) {
  return THREAD_PANEL_TABS.filter((tab) => available[tab]);
}

/** The last tab each thread's panel showed, for this app session. */
export const lastThreadPanelTabs = new Map<string, ThreadPanelTab>();

/** The tab the panel shows: the one asked for, else the thread's last one, else the first it can show. */
export function resolveThreadPanelTab(input: {
  readonly tabs: ReadonlyArray<ThreadPanelTab>;
  readonly presentation: ThreadPanelPresentation;
  readonly requested: ThreadPanelTab | null;
  readonly remembered: ThreadPanelTab | undefined;
}): ThreadPanelTab | null {
  const shown = input.tabs.filter((tab) => threadPanelShowsTab(tab, input.presentation));
  for (const tab of [input.requested, input.remembered]) {
    if (tab && shown.includes(tab)) return tab;
  }
  return shown[0] ?? null;
}

/** The thread's linked pull requests, else the open branch's pull request from git status. */
export function resolveThreadPullRequest(input: {
  readonly thread: Pick<EnvironmentThreadShell, "pullRequests">;
  readonly supportsLinks: boolean;
  readonly gitStatus: Pick<VcsStatusResult, "pr" | "sourceControlProvider"> | null;
}): ThreadPrPresentation | null {
  const linked = input.supportsLinks
    ? presentThreadLinkedPullRequests(input.thread.pullRequests)
    : null;
  if (linked) return linked;
  return input.gitStatus?.pr
    ? presentThreadPr(input.gitStatus.pr, input.gitStatus.sourceControlProvider)
    : null;
}
