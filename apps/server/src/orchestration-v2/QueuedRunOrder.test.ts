import { describe, expect, it } from "vite-plus/test";

import { queuedRunsInDeliveryOrder } from "./QueuedRunOrder.ts";

describe("queued run delivery order", () => {
  it("keeps automatic completion delivery ahead of visible queued messages", () => {
    const projection = {
      messages: [
        { id: "message:visible-first" },
        {
          id: "message:automatic",
          delegatedCompletion: {
            generation: 1,
            parentRunId: "run:parent",
            taskIds: ["task:child"],
          },
        },
        { id: "message:visible-second" },
      ],
      runs: [
        {
          id: "run:visible-first",
          ordinal: 2,
          queuePosition: 1,
          status: "queued",
          userMessageId: "message:visible-first",
        },
        {
          id: "run:automatic",
          ordinal: 4,
          queuePosition: 3,
          status: "queued",
          userMessageId: "message:automatic",
        },
        {
          id: "run:visible-second",
          ordinal: 3,
          queuePosition: 2,
          status: "queued",
          userMessageId: "message:visible-second",
        },
      ],
    } as never;

    expect(queuedRunsInDeliveryOrder(projection).map((run) => run.id)).toEqual([
      "run:automatic",
      "run:visible-first",
      "run:visible-second",
    ]);
  });

  it("keeps a stored completion queued behind visible messages ahead of them", () => {
    const completion = (generation: number) => ({
      id: `message:completion-${generation}`,
      delegatedCompletion: { generation, parentRunId: "run:parent", taskIds: ["task:child"] },
    });
    const projection = {
      messages: [{ id: "message:visible" }, completion(1), completion(2)],
      runs: [
        { id: "run:visible", ordinal: 2, queuePosition: 1, status: "queued" },
        { id: "run:completion-1", ordinal: 3, queuePosition: 2, status: "queued" },
        { id: "run:completion-2", ordinal: 4, queuePosition: 3, status: "queued" },
      ].map((run) => ({ ...run, userMessageId: run.id.replace("run:", "message:") })),
    } as never;

    expect(queuedRunsInDeliveryOrder(projection).map((run) => run.id)).toEqual([
      "run:completion-1",
      "run:completion-2",
      "run:visible",
    ]);
  });

  it("delivers a message reordered ahead of completions before them", () => {
    const projection = {
      messages: [
        { id: "message:visible" },
        {
          id: "message:automatic",
          delegatedCompletion: {
            generation: 1,
            parentRunId: "run:parent",
            taskIds: ["task:child"],
          },
        },
        { id: "message:later" },
      ],
      runs: [
        { id: "run:automatic", ordinal: 2, queuePosition: 2, status: "queued" },
        {
          id: "run:visible",
          ordinal: 3,
          queuePosition: 1,
          queuedAheadOfCompletions: true,
          status: "queued",
        },
        { id: "run:later", ordinal: 4, queuePosition: 3, status: "queued" },
      ].map((run) => ({ ...run, userMessageId: run.id.replace("run:", "message:") })),
    } as never;

    expect(queuedRunsInDeliveryOrder(projection).map((run) => run.id)).toEqual([
      "run:visible",
      "run:automatic",
      "run:later",
    ]);
  });
});
