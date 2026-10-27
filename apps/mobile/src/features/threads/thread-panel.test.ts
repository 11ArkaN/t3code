import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { resolveThreadPanelTab, resolveThreadPullRequest, threadPanelTabs } from "./thread-panel";

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

  it("prefers the requested tab, then the thread's last tab, then the first one", () => {
    const resolve = (requested: "terminal" | "files" | null, remembered?: "terminal" | "files") =>
      resolveThreadPanelTab({ tabs, presentation: "sheet", requested, remembered });
    expect(resolve("files", "terminal")).toBe("files");
    expect(resolve(null, "files")).toBe("files");
    expect(resolve(null)).toBe("terminal");
  });

  it("skips tabs that open their own screen", () => {
    expect(
      resolveThreadPanelTab({
        tabs,
        presentation: "sheet",
        requested: "diff",
        remembered: "device",
      }),
    ).toBe("terminal");
    expect(
      resolveThreadPanelTab({
        tabs,
        presentation: "column",
        requested: null,
        remembered: "device",
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
      }),
    ).toBe("files");
    expect(
      resolveThreadPanelTab({
        tabs: ["diff"],
        presentation: "sheet",
        requested: null,
        remembered: undefined,
      }),
    ).toBeNull();
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
