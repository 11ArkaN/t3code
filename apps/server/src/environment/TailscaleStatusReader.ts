import {
  readTailscaleStatus,
  type TailscaleCommandError,
  type TailscaleStatus,
  type TailscaleStatusParseError,
} from "@t3tools/tailscale";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

type TailscaleStatusError = TailscaleCommandError | TailscaleStatusParseError;

export class TailscaleStatusReader extends Context.Service<
  TailscaleStatusReader,
  {
    readonly read: () => Effect.Effect<TailscaleStatus, TailscaleStatusError>;
    /** Emits when a read settles to a different outcome than the previous settled read. */
    readonly subscribeChanges: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
  }
>()("t3/environment/TailscaleStatusReader") {}

// Callers treat every failure alike, so failures compare equal regardless of cause.
const outcomeKey = (exit: Exit.Exit<TailscaleStatus, TailscaleStatusError>) =>
  Exit.isSuccess(exit) ? JSON.stringify(exit.value) : null;

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // The layer's scope, so a caller that times out or disconnects never interrupts the shared read.
  const scope = yield* Effect.scope;
  const changes = yield* PubSub.unbounded<void>();
  let settled: Exit.Exit<TailscaleStatus, TailscaleStatusError> | undefined;
  let inFlight: Deferred.Deferred<TailscaleStatus, TailscaleStatusError> | undefined;

  const refresh = Effect.suspend(() => {
    if (inFlight !== undefined) return Effect.succeed(inFlight);
    const deferred = Deferred.makeUnsafe<TailscaleStatus, TailscaleStatusError>();
    inFlight = deferred;
    return readTailscaleStatus.pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.onExit((exit) =>
        Effect.suspend(() => {
          const changed = settled === undefined || outcomeKey(settled) !== outcomeKey(exit);
          settled = exit;
          inFlight = undefined;
          return Deferred.done(deferred, exit).pipe(
            Effect.andThen(changed ? PubSub.publish(changes, undefined) : Effect.void),
          );
        }),
      ),
      Effect.forkIn(scope),
      Effect.as(deferred),
    );
  });
  yield* refresh;

  return TailscaleStatusReader.of({
    // A caller gets the previous read's result; the refresh it starts serves the next caller
    // and, when its outcome differs, reaches open subscribers through `subscribeChanges`.
    read: Effect.fn("TailscaleStatusReader.read")(function* () {
      const previous = settled;
      const pending = yield* refresh;
      return yield* previous ?? Deferred.await(pending);
    }),
    subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
  });
});

export const layer = Layer.effect(TailscaleStatusReader, make);
