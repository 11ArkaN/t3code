import { assert, describe, it } from "@effect/vitest";

import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("links only PRs T3 does not link from a create command, and no read-only ones", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    assert.include(
      instructions,
      "T3 links a PR that one gh pr create or glab mr create command prints.",
    );
    assert.include(
      instructions,
      "Call link_pull_request for any other PR you create (in a loop, via an API), take over, or push to.",
    );
    assert.include(instructions, "Skip PRs you only read, review, or mention.");
    assert.notInclude(instructions, "git log -1");
    assert.notInclude(instructions, "work on");
    // Listing linked PRs as an end-of-work check found nothing to add in audited threads.
    assert.notInclude(instructions, "list_thread_pull_requests");
  });

  it("waits on a PR only with the watch, never with a poll loop", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });

    // The wake message itself carries the do-not-re-watch rule.
    assert.notInclude(instructions, "On a wake");
    assert.include(
      instructions,
      "When asked to babysit or monitor, or when your task, such as a merge, waits on checks or reviews, even after an earlier unwatch: push any needed branch update, call watch_pull_request, and end your turn.",
    );
    assert.notInclude(instructions, "merge it now");
    assert.include(instructions, "Otherwise act now or hand back.");
    assert.include(instructions, "Never wait with sleep");
    // Children cannot see watch_pull_request, so they only need the no-poll rule and the report.
    assert.include(
      instructions,
      "A delegated child never polls, even when asked to babysit, and ends with: PR <full URL>, head <SHA>, checks and reviews <state>.",
    );
    assert.include(instructions, "call unwatch_pull_request");
  });
});
