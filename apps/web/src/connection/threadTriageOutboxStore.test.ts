import { describe, expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ThreadTriageOutboxStorageError } from "@t3tools/client-runtime/platform";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import { afterEach, vi } from "vite-plus/test";

import { browserThreadTriageOutboxStore } from "./threadTriageOutboxStore";

const queuedSettle = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
  commandId: CommandId.make("queued-settle"),
  action: { type: "settle" as const },
  queuedAt: DateTime.makeUnsafe("2026-09-12T10:00:00.000Z"),
  snapshotSequence: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser thread triage storage", () => {
  it.effect.each(["unavailable", "rejected"] as const)(
    "refuses to save queued changes when the shared lock is %s",
    (lock) =>
      Effect.gen(function* () {
        const setItem = vi.fn();
        vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem } });
        vi.stubGlobal(
          "navigator",
          lock === "unavailable"
            ? {}
            : { locks: { request: () => Promise.reject(new Error("Lock request denied")) } },
        );

        const result = yield* Effect.exit(browserThreadTriageOutboxStore.put(queuedSettle));

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(Cause.squash(result.cause)).toBeInstanceOf(ThreadTriageOutboxStorageError);
        }
        expect(setItem).not.toHaveBeenCalled();
      }),
  );

  it.effect.each(["success", "failure"] as const)(
    "releases the acquired lock after storage %s",
    (outcome) =>
      Effect.gen(function* () {
        const released = yield* Queue.unbounded<void>();
        let raw: string | null = null;
        vi.stubGlobal("window", {
          localStorage: {
            getItem: () => raw,
            setItem: (_key: string, value: string) => {
              if (outcome === "failure") throw new Error("Storage write denied");
              raw = value;
            },
          },
        });
        vi.stubGlobal("navigator", {
          locks: {
            request: async (
              _name: string,
              _options: LockOptions,
              callback: () => Promise<unknown>,
            ) => {
              try {
                return await callback();
              } finally {
                Queue.offerUnsafe(released, undefined);
              }
            },
          },
        });
        const result = yield* Effect.exit(browserThreadTriageOutboxStore.put(queuedSettle));
        yield* Queue.take(released);

        expect(result._tag).toBe(outcome === "success" ? "Success" : "Failure");
        expect((yield* browserThreadTriageOutboxStore.load).entries).toEqual(
          outcome === "success" ? [queuedSettle] : [],
        );
      }),
  );

  it.effect("clears retained environment state even when its storage lock is unavailable", () =>
    Effect.gen(function* () {
      vi.stubGlobal("navigator", {});
      const environmentId = EnvironmentId.make("removed");
      const retained = new Set([environmentId]);
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          browserThreadTriageOutboxStore.subscribeCleared((removed) => retained.delete(removed)),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );

      const result = yield* Effect.exit(
        browserThreadTriageOutboxStore.clearEnvironment(environmentId),
      );

      expect(result._tag).toBe("Failure");
      expect(retained.size).toBe(0);
    }),
  );

  it.effect("cancels a pending lock request before it can write", () =>
    Effect.gen(function* () {
      const requested = yield* Queue.unbounded<{
        signal: AbortSignal | undefined;
        grant: () => Promise<void>;
      }>();
      const setItem = vi.fn();
      vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem } });
      vi.stubGlobal("navigator", {
        locks: {
          request: (
            _name: string,
            options: LockOptions | (() => Promise<unknown>),
            callback?: () => Promise<unknown>,
          ) =>
            new Promise((resolve, reject) => {
              const signal = typeof options === "function" ? undefined : options.signal;
              const acquired = typeof options === "function" ? options : callback!;
              signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
              Queue.offerUnsafe(requested, {
                signal,
                grant: async () => {
                  if (!signal?.aborted) resolve(await acquired());
                },
              });
            }),
        },
      });

      const saving = yield* browserThreadTriageOutboxStore.put(queuedSettle).pipe(Effect.forkChild);
      const request = yield* Queue.take(requested);
      try {
        // A broken uninterruptible acquisition must still be released after the assertion.
        yield* Effect.sync(() => saving.interruptUnsafe());
        expect(request.signal?.aborted).toBe(true);
      } finally {
        yield* Effect.promise(request.grant);
        yield* Fiber.interrupt(saving);
      }
      expect(setItem).not.toHaveBeenCalled();
    }),
  );

  it.effect("uses the caller's logger during a locked storage read", () =>
    Effect.gen(function* () {
      const warnings: unknown[] = [];
      vi.stubGlobal("window", {
        localStorage: { getItem: () => "{invalid", setItem: () => {} },
      });
      vi.stubGlobal("navigator", {
        locks: {
          request: (_name: string, _options: LockOptions, callback: () => Promise<unknown>) =>
            callback(),
        },
      });

      yield* browserThreadTriageOutboxStore
        .put(queuedSettle)
        .pipe(
          Effect.provideService(
            Logger.CurrentLoggers,
            new Set([Logger.make(({ message }) => warnings.push(message))]),
          ),
        );

      expect(warnings).toHaveLength(1);
    }),
  );
});
