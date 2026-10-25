import { assert, describe, it } from "@effect/vitest";

import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("links PRs the agent creates, takes over, or pushes to, and no others", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.include(instructions, "Link every PR you create, take over, or push to");
    assert.include(instructions, "as your next call, before you view, edit, or check that PR");
    assert.include(instructions, "Do not link PRs you only read, review, or score");
    assert.notInclude(instructions, "work on");
    // Listing linked PRs as an end-of-work check found nothing to add in audited threads.
    assert.notInclude(instructions, "list_thread_pull_requests");
  });

  it("waits on a PR only with the watch, never with a poll loop", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.include(instructions, "Do not watch a PR just because you created it");
    assert.include(instructions, "stays linked across pushes and wakes");
    assert.include(
      instructions,
      "Call watch_pull_request only when asked to monitor or babysit it",
    );
    assert.notInclude(instructions, "merge it now");
    assert.include(instructions, "If the PR is ready, merge it. Do not watch.");
    assert.include(instructions, "call it first, before checks, diffs, or branch updates");
    assert.include(instructions, "Never wait with sleep");
    assert.include(instructions, "call unwatch_pull_request");
  });
});
