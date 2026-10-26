import type { OrchestrationV2Run, OrchestrationV2ThreadProjection } from "@t3tools/contracts";

export function isAutomaticCompletionRun(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
  run: OrchestrationV2Run,
): boolean {
  return projection.messages.some(
    (message) => message.id === run.userMessageId && message.delegatedCompletion !== undefined,
  );
}

/** At an equal queue position, automatic completion delivery runs before visible messages. */
export function queuedRunsInDeliveryOrder(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
): ReadonlyArray<OrchestrationV2Run> {
  const automaticCompletionMessageIds = new Set(
    projection.messages
      .filter((message) => message.delegatedCompletion !== undefined)
      .map((message) => message.id),
  );
  return projection.runs
    .filter((run) => run.status === "queued")
    .toSorted(
      (left, right) =>
        (left.queuePosition ?? left.ordinal) - (right.queuePosition ?? right.ordinal) ||
        Number(automaticCompletionMessageIds.has(right.userMessageId)) -
          Number(automaticCompletionMessageIds.has(left.userMessageId)) ||
        left.ordinal - right.ordinal,
    );
}

/** A new completion shares the last queued completion's position, else the queue head's. */
export function nextAutomaticCompletionQueuePosition(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
): number {
  const queuedRuns = queuedRunsInDeliveryOrder(projection);
  const anchor =
    queuedRuns.findLast((run) => isAutomaticCompletionRun(projection, run)) ?? queuedRuns[0];
  return anchor === undefined ? 1 : (anchor.queuePosition ?? anchor.ordinal);
}
