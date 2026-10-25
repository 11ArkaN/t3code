import { assert, describe, it } from "@effect/vitest";

import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("links PRs the agent creates, takes over, or pushes to, and no others", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.include(instructions, "Link each PR you create, take over, or push to");
    assert.include(instructions, "one link_pull_request per PR");
    assert.include(instructions, "Skip PRs you only read, review, or score");
    assert.notInclude(instructions, "git log -1");
    assert.notInclude(instructions, "work on");
    // Listing linked PRs as an end-of-work check found nothing to add in audited threads.
    assert.notInclude(instructions, "list_thread_pull_requests");
  });

  it("waits on a PR only with the watch, never with a poll loop", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.include(instructions, "Creation, pending checks, or a merge ask alone is not enough");
    assert.include(instructions, "A link persists.");
    assert.include(instructions, "Watch only if asked to monitor or babysit");
    assert.notInclude(instructions, "merge it now");
    assert.include(instructions, "If ready, act.");
    assert.include(instructions, "your first tool call is watch_pull_request");
    assert.include(instructions, "never watch or poll, even if the brief says babysit");
    assert.include(instructions, "report at once: PR URL, head SHA, check state");
    assert.include(instructions, "Never wait with sleep");
    assert.include(instructions, "call unwatch_pull_request");
  });
});
