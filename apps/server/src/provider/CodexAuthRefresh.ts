// @effect-diagnostics nodeBuiltinImport:off - session open resolves this without a Path service.
import * as NodePath from "node:path";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

// Codex refreshes ChatGPT tokens 5 minutes before the access token expires, or 8 days after
// last_refresh when the token has no exp, and locks that only inside one process. Two
// app-servers on one auth.json can spend the same rotating refresh token, which revokes the login.
const CODEX_EXPIRY_WINDOW_MS = 5 * 60_000;
const CODEX_REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60_000;
const REFRESH_LEAD_MS = 10 * 60_000;
const CHECK_INTERVAL = "5 minutes";
const LOCK_WAIT = "20 seconds";
const REFRESH_TIMEOUT = "15 seconds";

const decodeCodexAuthFile = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      auth_mode: Schema.optional(Schema.NullOr(Schema.String)),
      OPENAI_API_KEY: Schema.optional(Schema.NullOr(Schema.String)),
      tokens: Schema.optional(Schema.NullOr(Schema.Struct({ access_token: Schema.String }))),
      last_refresh: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);
const decodeJwtClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ exp: Schema.optional(Schema.Number) })),
);

/** Whether T3 should refresh this auth.json now, ahead of the point where Codex would. */
export function isCodexAuthRefreshDue(authJson: string, nowMs: number): boolean {
  const auth = Option.getOrUndefined(decodeCodexAuthFile(authJson));
  const accessToken = auth?.tokens?.access_token;
  const mode = auth?.auth_mode ?? (auth?.OPENAI_API_KEY ? "apikey" : "chatgpt");
  if (accessToken === undefined || mode !== "chatgpt") return false;
  const payload = accessToken.split(".")[1] ?? "";
  const claims = decodeJwtClaims(Buffer.from(payload, "base64url").toString("utf8"));
  const exp = Option.getOrUndefined(claims)?.exp;
  const lastRefreshMs = Date.parse(auth?.last_refresh ?? "");
  const codexRefreshAtMs =
    exp !== undefined
      ? exp * 1000 - CODEX_EXPIRY_WINDOW_MS
      : lastRefreshMs + CODEX_REFRESH_INTERVAL_MS;
  return nowMs >= codexRefreshAtMs - REFRESH_LEAD_MS;
}

/** The auth.json an app-server reads: CODEX_HOME, else ~/.codex, as Codex resolves it. */
export function codexAuthPath(
  homePath: string,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const userHome = environment.HOME || environment.USERPROFILE;
  const codexHome =
    homePath || environment.CODEX_HOME || (userHome ? NodePath.join(userHome, ".codex") : "");
  return codexHome ? NodePath.join(codexHome, "auth.json") : undefined;
}

const homeLocks = new Map<string, Semaphore.Semaphore>();

/**
 * Makes one T3-chosen app-server refresh the ChatGPT login per Codex home. Call before spawning
 * the app-server: Codex refreshes at startup, so a due login keeps the home lock until `start`.
 * `start` refreshes through the new client if still due, then rechecks every few minutes.
 */
export const openCodexAuthRefresh = Effect.fn("CodexAuthRefresh.open")(function* (
  authPath: string | undefined,
) {
  if (authPath === undefined) {
    return { start: <E>(_refresh: Effect.Effect<unknown, E>) => Effect.void };
  }
  const scope = yield* Scope.Scope;
  const fileSystem = yield* FileSystem.FileSystem;
  const homeLock = homeLocks.get(authPath) ?? Semaphore.makeUnsafe(1);
  homeLocks.set(authPath, homeLock);
  const isDue = Effect.all([
    fileSystem.readFileString(authPath).pipe(Effect.option),
    Clock.currentTimeMillis,
  ]).pipe(
    Effect.map(([authJson, nowMs]) =>
      Option.exists(authJson, (json) => isCodexAuthRefreshDue(json, nowMs)),
    ),
  );
  const gate = yield* Scope.fork(scope);
  const holdsLock =
    (yield* isDue) &&
    (yield* Effect.acquireRelease(
      homeLock.take(1).pipe(Effect.timeoutOption(LOCK_WAIT), Effect.map(Option.isSome)),
      (taken) => (taken ? homeLock.release(1) : Effect.void),
      { interruptible: true },
    ).pipe(Scope.provide(gate)));

  return {
    start: Effect.fn("CodexAuthRefresh.start")(function* <E>(refresh: Effect.Effect<unknown, E>) {
      // Callers hold the home lock; the reread skips homes another app-server already refreshed.
      // account/read can fail after its refresh succeeds, so auth.json decides the outcome.
      const refreshIfStillDue = Effect.gen(function* () {
        if (!(yield* isDue)) return;
        const exit = yield* refresh.pipe(Effect.timeout(REFRESH_TIMEOUT), Effect.exit);
        if (yield* isDue) {
          yield* Effect.logWarning("Codex auth refresh did not update auth.json.", {
            authPath,
            cause: Exit.isFailure(exit) ? exit.cause : undefined,
          });
        }
      });
      if (holdsLock) {
        yield* refreshIfStillDue.pipe(Effect.ensuring(Scope.close(gate, Exit.void)));
      }
      yield* Effect.sleep(CHECK_INTERVAL).pipe(
        Effect.andThen(isDue),
        Effect.flatMap((due) => (due ? homeLock.withPermit(refreshIfStillDue) : Effect.void)),
        Effect.forever,
        Effect.forkIn(scope),
      );
    }),
  };
});
