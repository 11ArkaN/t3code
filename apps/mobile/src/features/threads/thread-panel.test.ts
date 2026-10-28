import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import {
  resolveThreadPanelTab,
  resolveThreadPullRequest,
  threadChangesLabel,
  threadPanelTabs,
} from "./thread-panel";

const none = {
  browser: false,
  terminal: false,
  files: false,
  diff: false,
  "pull-request": false,
  device: false,
};

describe("threadPanelTabs", () => {
  it("keeps desktop's order and drops tabs that do not apply", () => {
    expect(
      threadPanelTabs({ ...none, device: true, diff: true, terminal: true, browser: true }),
    ).toEqual(["browser", "terminal", "diff", "device"]);
    expect(threadPanelTabs(none)).toEqual([]);
  });
});

describe("resolveThreadPanelTab", () => {
  const tabs = threadPanelTabs({ ...none, terminal: true, files: true, diff: true, device: true });

  it("prefers the requested tab, then the thread's last tab, then Diff with changes, then the first one", () => {
    const resolve = (
      requested: "terminal" | "files" | null,
      remembered?: "terminal" | "files",
      hasChanges = false,
    ) => resolveThreadPanelTab({ tabs, presentation: "sheet", requested, remembered, hasChanges });
    expect(resolve("files", "terminal", true)).toBe("files");
    expect(resolve(null, "files", true)).toBe("files");
    expect(resolve(null, undefined, true)).toBe("diff");
    expect(resolve(null)).toBe("terminal");
  });

  it("shows diff in place and skips tabs that open their own screen", () => {
    expect(
      resolveThreadPanelTab({
        tabs,
        presentation: "sheet",
        requested: "device",
        remembered: "diff",
        hasChanges: false,
      }),
    ).toBe("diff");
    expect(
      resolveThreadPanelTab({
        tabs,
        presentation: "column",
        requested: null,
        remembered: "device",
        hasChanges: false,
      }),
    ).toBe("device");
  });

  it("skips a remembered tab that no longer applies", () => {
    expect(
      resolveThreadPanelTab({
        tabs: ["files"],
        presentation: "column",
        requested: null,
        remembered: "terminal",
        hasChanges: true,
      }),
    ).toBe("files");
    expect(
      resolveThreadPanelTab({
        tabs: ["browser", "pull-request"],
        presentation: "sheet",
        requested: null,
        remembered: undefined,
        hasChanges: false,
      }),
    ).toBeNull();
  });
});

describe("threadChangesLabel", () => {
  const workingTree = { files: [], insertions: 3, deletions: 1 };

  it("shows the branch's changes like desktop, else the working tree's", () => {
    expect(
      threadChangesLabel({
        isRepo: true,
        workingTree,
        branchChanges: { baseRef: "main", insertions: 15, deletions: 2 },
      }),
    ).toBe("+15 -2");
    expect(threadChangesLabel({ isRepo: true, workingTree })).toBe("+3 -1");
  });

  it("is absent without changes or a repository", () => {
    expect(
      threadChangesLabel({ isRepo: true, workingTree: { files: [], insertions: 0, deletions: 0 } }),
    ).toBeNull();
    expect(threadChangesLabel({ isRepo: false, workingTree })).toBeNull();
    expect(threadChangesLabel(null)).toBeNull();
  });
});

describe("resolveThreadPullRequest", () => {
  const branchPr = {
    number: 7,
    title: "Branch",
    url: "https://github.com/t3/code/pull/7",
    baseRef: "main",
    headRef: "feature",
    state: "open" as const,
  };

  it("falls back to the branch pull request when nothing is linked", () => {
    const pr = resolveThreadPullRequest({
      thread: makeThreadShellFixture(),
      supportsLinks: true,
      gitStatus: { pr: branchPr },
    });
    expect(pr?.url).toBe(branchPr.url);
  });

  it("is absent without a linked or branch pull request", () => {
    expect(
      resolveThreadPullRequest({
        thread: makeThreadShellFixture(),
        supportsLinks: true,
        gitStatus: null,
      }),
    ).toBeNull();
  });
});
