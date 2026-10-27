import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitleMenu, type ThreadTitleMenuState } from "./thread-title-menu";

const state: ThreadTitleMenuState = {
  canOperate: true,
  branch: "feature",
  hasPath: true,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: resolveSnoozePresets(new Date("2026-10-27T12:00:00.000Z")),
  pullRequestLabel: null,
  canMergeBack: false,
};

const ids = (overrides: Partial<ThreadTitleMenuState> = {}) =>
  buildThreadTitleMenu({ ...state, ...overrides }).map((group) => group.map((item) => item.id));

describe("buildThreadTitleMenu", () => {
  it("lists desktop's actions in desktop's groups", () => {
    expect(ids()).toEqual([
      ["new-thread-on-branch", "pin", "settle", "snooze"],
      ["rename", "regenerate-title", "auto-settle"],
      ["copy"],
      ["archive", "delete"],
    ]);
    const labels = buildThreadTitleMenu(state).flatMap((group) => group.map((item) => item.label));
    expect(labels).toEqual([
      "New thread on feature",
      "Pin thread",
      "Settle thread",
      "Snooze",
      "Rename thread",
      "Regenerate title",
      "Auto-settle behavior",
      "Copy",
      "Archive thread",
      "Delete",
    ]);
  });

  it("offers the way back from pinned, settled and snoozed threads", () => {
    expect(ids({ isPinned: true, isSettled: true, isSnoozed: true })[0]).toEqual([
      "new-thread-on-branch",
      "unpin",
      "unsettle",
      "unsnooze",
    ]);
  });

  it("drops actions the server does not support and copy targets that do not exist", () => {
    const menu = buildThreadTitleMenu({
      ...state,
      branch: null,
      hasPath: false,
      supports: {
        settlement: false,
        autoSettleOptOut: false,
        snooze: false,
        pinning: false,
        titleRegeneration: false,
      },
    });
    expect(menu.map((group) => group.map((item) => item.id))).toEqual([
      ["rename"],
      ["copy"],
      ["archive", "delete"],
    ]);
    expect(menu[1]?.[0]?.children?.map((item) => item.id)).toEqual(["copy-thread-id"]);
  });

  it("groups the pull request and merge back between the title and copy actions", () => {
    expect(ids({ pullRequestLabel: "Open pull request", canMergeBack: true })[2]).toEqual([
      "open-pull-request",
      "merge-back",
    ]);
  });

  it("ends snooze presets with Custom and disables snooze while the thread cannot snooze", () => {
    const snooze = buildThreadTitleMenu({ ...state, canSnoozeNow: false })[0]?.find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.at(-1)?.id).toBe("snooze:custom");
    expect(snooze?.children?.length).toBe(state.snoozePresets.length + 1);
  });

  it("disables archive while the thread runs", () => {
    const archive = buildThreadTitleMenu({ ...state, isRunning: true })
      .flat()
      .find((item) => item.id === "archive");
    expect(archive?.disabled).toBe(true);
  });

  it("leaves navigation and copying to read-only connections", () => {
    const enabled = (items: ReadonlyArray<{ readonly id: string; readonly disabled?: boolean }>) =>
      items.filter((item) => !item.disabled).map((item) => item.id);
    const menu = buildThreadTitleMenu({
      ...state,
      canOperate: false,
      pullRequestLabel: "Open pull request",
      canMergeBack: true,
    });
    expect(enabled(menu.flat())).toEqual(["new-thread-on-branch", "open-pull-request", "copy"]);
    const copy = menu.flat().find((item) => item.id === "copy");
    expect(enabled(copy?.children ?? [])).toEqual(["copy-path", "copy-branch", "copy-thread-id"]);
    const snooze = menu.flat().find((item) => item.id === "snooze");
    expect(enabled(snooze?.children ?? [])).toEqual([]);
  });
});
