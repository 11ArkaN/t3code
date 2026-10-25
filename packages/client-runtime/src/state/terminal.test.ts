import { expect, it } from "vite-plus/test";

import {
  INITIAL_TERMINAL_LIFECYCLE,
  transitionTerminalLifecycle,
  type TerminalLifecycleEvent,
} from "./terminal.ts";
import type { TerminalBufferState } from "./terminalSession.ts";

function run(events: ReadonlyArray<TerminalLifecycleEvent>) {
  let state = INITIAL_TERMINAL_LIFECYCLE;
  const commands: Array<string> = [];
  for (const event of events) {
    const step = transitionTerminalLifecycle(state, event);
    state = step.state;
    if (step.command !== null) commands.push(step.command);
  }
  return commands;
}

const status = (value: TerminalBufferState["status"], version = 1): TerminalLifecycleEvent => ({
  type: "status",
  status: value,
  version,
});

it("does not respawn a terminal that exited after operate was revoked", () => {
  expect(
    run([status("running"), { type: "detached", canOperate: false }, status("exited")]),
  ).toEqual([]);
});

it("reopens an ended terminal on an explicit visit, once until it runs again", () => {
  expect(run([status("exited"), status("exited", 2)])).toEqual(["reopen"]);
  expect(run([status("exited"), status("running", 3), status("exited", 4)])).toEqual([
    "reopen",
    "exit",
  ]);
  expect(run([status("exited"), { type: "reopen-failed" }, status("exited", 2)])).toEqual([
    "reopen",
    "reopen",
  ]);
});

it("keeps a detached terminal from being mistaken for a live exit", () => {
  expect(
    run([status("running"), { type: "detached", canOperate: true }, status("exited")]),
  ).toEqual(["reopen"]);
});

it("leaves the history a viewer was reading when operate is granted", () => {
  expect(run([{ type: "observed" }, status("exited")])).toEqual([]);
});
