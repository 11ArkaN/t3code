import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Metric from "effect/Metric";
import * as Semaphore from "effect/Semaphore";
import * as TestClock from "effect/testing/TestClock";

import {
  orchestrationCommandDuration,
  orchestrationCommandsTotal,
  withMetricsAfterLock,
} from "./Metrics.ts";

it.effect("records locked work after the lock is released, excluding lock wait", () =>
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1);
    let held = false;
    const heldWhenRecorded: Array<boolean> = [];
    const lock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      semaphore.withPermit(
        Effect.sync(() => {
          held = true;
        }).pipe(
          Effect.andThen(effect),
          Effect.ensuring(
            Effect.sync(() => {
              held = false;
            }),
          ),
        ),
      );
    const releaseHolder = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(semaphore.withPermit(Deferred.await(releaseHolder)));

    const metered = yield* Effect.forkChild(
      withMetricsAfterLock(
        {
          counter: orchestrationCommandsTotal,
          timer: orchestrationCommandDuration,
          attributes: () => {
            heldWhenRecorded.push(held);
            return { commandType: "thread.create" };
          },
        },
        (timed) => lock(timed(Effect.sleep("2 seconds").pipe(Effect.andThen(Effect.fail("boom"))))),
      ),
    );
    yield* TestClock.adjust("5 seconds");
    yield* Deferred.succeed(releaseHolder, undefined);
    yield* Fiber.join(holder);
    yield* TestClock.adjust("2 seconds");
    assert.isTrue(Exit.isFailure(yield* Fiber.await(metered)));

    assert.deepEqual(heldWhenRecorded, [false]);
    const snapshots = yield* Metric.snapshot;
    const counter = snapshots.find((snapshot) => snapshot.type === "Counter");
    assert.deepEqual(counter?.attributes, { commandType: "thread.create", outcome: "failure" });
    assert.equal(counter?.state.count, 1);
    const duration = snapshots.find((snapshot) => snapshot.type === "Histogram");
    assert.equal(duration?.state.count, 1);
    assert.equal(duration?.state.sum, 2000);
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

it.effect("records interruption while waiting for the lock unless unstarted work is skipped", () =>
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1);
    const releaseHolder = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(semaphore.withPermit(Deferred.await(releaseHolder)));
    const waiting = (unstarted: "record" | "skip", commandType: string) =>
      Effect.forkChild(
        withMetricsAfterLock(
          {
            counter: orchestrationCommandsTotal,
            timer: orchestrationCommandDuration,
            attributes: { commandType },
          },
          (timed) => semaphore.withPermit(timed(Effect.void)),
          unstarted,
        ),
      );
    const recorded = yield* waiting("record", "thread.create");
    const skipped = yield* waiting("skip", "thread.metadata.update");
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(recorded);
    yield* Fiber.interrupt(skipped);
    yield* Deferred.succeed(releaseHolder, undefined);
    yield* Fiber.join(holder);

    const snapshots = yield* Metric.snapshot;
    const counters = snapshots.filter((snapshot) => snapshot.type === "Counter");
    assert.deepEqual(
      counters.map((snapshot) => ({
        attributes: snapshot.attributes,
        count: snapshot.state.count,
      })),
      [{ attributes: { commandType: "thread.create", outcome: "interrupt" }, count: 1 }],
    );
    const durations = snapshots.filter((snapshot) => snapshot.type === "Histogram");
    assert.lengthOf(durations, 1);
    assert.equal(durations[0]?.state.sum, 0);
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);
