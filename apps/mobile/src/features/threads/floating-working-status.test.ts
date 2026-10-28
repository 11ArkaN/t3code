import { describe, expect, it } from "vite-plus/test";

import { feedEndInset, runStatusSegments } from "./floating-working-status";

const idle = {
  status: null,
  hasAgents: false,
  queuedCount: 0,
  previewCount: 0,
  showScrollToEnd: false,
} as const;

describe("runStatusSegments", () => {
  it("orders segments like desktop: status, agents, queue, previews, then scroll-to-end", () => {
    expect(
      runStatusSegments({
        status: { kind: "working", startedAt: "2026-10-28T12:00:00.000Z" },
        hasAgents: true,
        queuedCount: 2,
        previewCount: 1,
        showScrollToEnd: true,
      }),
    ).toEqual(["status", "agents", "queue", "previews", "scroll-to-end"]);
  });

  it("shows only what the thread has", () => {
    expect(runStatusSegments({ ...idle, queuedCount: 3 })).toEqual(["queue"]);
    expect(runStatusSegments({ ...idle, hasAgents: true, previewCount: 2 })).toEqual([
      "agents",
      "previews",
    ]);
  });

  it("takes no space when there is nothing to show, even while scrolled up", () => {
    expect(runStatusSegments(idle)).toEqual([]);
    expect(runStatusSegments({ ...idle, showScrollToEnd: true })).toEqual([]);
  });
});

describe("feedEndInset", () => {
  const input = { composerBlock: 180, runStatus: 40, questionCard: 120 };

  it("counts the docked row once, inside the measured composer block", () => {
    expect(feedEndInset({ ...input, docksRunStatus: true })).toBe(300);
  });

  it("adds the floating capsule's coverage above the block", () => {
    expect(feedEndInset({ ...input, docksRunStatus: false })).toBe(340);
  });
});
