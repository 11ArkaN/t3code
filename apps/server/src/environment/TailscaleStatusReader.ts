import {
  readTailscaleStatus,
  type TailscaleCommandError,
  type TailscaleStatus,
  type TailscaleStatusParseError,
} from "@t3tools/tailscale";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

type TailscaleStatusError = TailscaleCommandError | TailscaleStatusParseError;

export class TailscaleStatusReader extends Context.Service<
  TailscaleStatusReader,
  {
    readonly read: () => Effect.Effect<TailscaleStatus, TailscaleStatusError>;
  }
>()("t3/environment/TailscaleStatusReader") {}

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // The layer's scope, so a caller that times out or disconnects never interrupts the shared read.
  const scope = yield* Effect.scope;
  let settled: Exit.Exit<TailscaleStatus, TailscaleStatusError> | undefined;
  let inFlight: Deferred.Deferred<TailscaleStatus, TailscaleStatusError> | undefined;

  const refresh = Effect.suspend(() => {
    if (inFlight !== undefined) return Effect.succeed(inFlight);
    const deferred = Deferred.makeUnsafe<TailscaleStatus, TailscaleStatusError>();
    inFlight = deferred;
    return readTailscaleStatus.pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          settled = exit;
          inFlight = undefined;
        }).pipe(Effect.andThen(Deferred.done(deferred, exit))),
      ),
      Effect.forkIn(scope),
      Effect.as(deferred),
    );
  });
  yield* refresh;

  return TailscaleStatusReader.of({
    // A caller gets the previous read's result; the refresh it starts serves the next caller.
    read: Effect.fn("TailscaleStatusReader.read")(function* () {
      const previous = settled;
      const pending = yield* refresh;
      return yield* previous ?? Deferred.await(pending);
    }),
  });
});

export const layer = Layer.effect(TailscaleStatusReader, make);
