import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { VcsStatusResult } from "@t3tools/contracts";
import { createContext } from "react";

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

// Browser and Pull request keep their own screens, which own a native header and navigator.
// The sheet also pushes Device: its swipe to dismiss would fight the device stream's gestures.
const TABS_SHOWN_IN_PANEL: Record<ThreadPanelPresentation, ReadonlySet<ThreadPanelTab>> = {
  sheet: new Set(["terminal", "files", "diff"]),
  column: new Set(["terminal", "files", "diff", "device"]),
};

/** True under the panel's tab strip, which is the only header its tabs show. */
export const InThreadPanelContext = createContext(false);

export function threadPanelShowsTab(tab: ThreadPanelTab, presentation: ThreadPanelPresentation) {
  return TABS_SHOWN_IN_PANEL[presentation].has(tab);
}

export function threadPanelTabs(available: Readonly<Record<ThreadPanelTab, boolean>>) {
  return THREAD_PANEL_TABS.filter((tab) => available[tab]);
}

/** The last tab each thread's panel showed, for this app session. */
export const lastThreadPanelTabs = new Map<string, ThreadPanelTab>();

/**
 * The tab the panel shows: the one asked for, else the thread's last one, else Diff when the
 * thread has changes, else the first it can show.
 */
export function resolveThreadPanelTab(input: {
  readonly tabs: ReadonlyArray<ThreadPanelTab>;
  readonly presentation: ThreadPanelPresentation;
  readonly requested: ThreadPanelTab | null;
  readonly remembered: ThreadPanelTab | undefined;
  readonly hasChanges: boolean;
}): ThreadPanelTab | null {
  const shown = input.tabs.filter((tab) => threadPanelShowsTab(tab, input.presentation));
  const changes: ThreadPanelTab | null = input.hasChanges ? "diff" : null;
  for (const tab of [input.requested, input.remembered, changes]) {
    if (tab && shown.includes(tab)) return tab;
  }
  return shown[0] ?? null;
}

/** Desktop's Changes stat: the branch's changes, else the working tree's. Null when there are none. */
export function threadChangesLabel(
  gitStatus: Pick<VcsStatusResult, "isRepo" | "branchChanges" | "workingTree"> | null | undefined,
): string | null {
  const totals = gitStatus?.isRepo ? (gitStatus.branchChanges ?? gitStatus.workingTree) : null;
  if (!totals || (totals.insertions === 0 && totals.deletions === 0)) return null;
  return `+${formatDiffCount(totals.insertions)} -${formatDiffCount(totals.deletions)}`;
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
