import type { ProviderInstanceId } from "@t3tools/contracts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { ProviderUsageScan } from "@t3tools/provider-core/server/usage";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  CURSOR_ACCOUNT_CACHE_FILE_NAME,
  CURSOR_ACCOUNT_TTL_MS,
  cursorFetchRange,
  decodeCursorAccountCaches,
  encodeCursorAccountCaches,
  isCursorCacheFresh,
  mergeCursorFetch,
  type CursorAccountCache,
  type CursorCredentialSource,
} from "./accountCache.ts";
import { accountHash } from "./accountUsage.ts";
import { readCursorBillingKey } from "./auth.ts";
import * as CursorAccountReader from "./CursorAccountReader.ts";
import { makeCursorCredentialStore } from "./credentialStore.ts";

const CURSOR_ACCOUNT_READ_ERROR = "Cursor account usage could not be read.";
const DEFAULT_CURSOR_BACKEND_URL = "https://api2.cursor.sh";
const API_KEY_CACHE_PREFIX = "api-key:";

const decodeCacheFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>),
);

export interface CursorUsageInstance {
  readonly instanceId: ProviderInstanceId;
  readonly name: string;
  readonly environment: NodeJS.ProcessEnv;
}

export class CursorUsageAccounts extends Context.Service<
  CursorUsageAccounts,
  {
    readonly scan: (input: {
      readonly instances: ReadonlyArray<CursorUsageInstance>;
      readonly keychainUsageEnabled: boolean;
      readonly windowStartMs: number;
      readonly retentionCutoffMs: number;
      readonly awaitRefresh: boolean;
    }) => Effect.Effect<ReadonlyArray<ProviderUsageScan>>;
    readonly awaitPersisted: Effect.Effect<void>;
  }
>()("@t3tools/provider-cursor/server/CursorUsageAccounts") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const host = yield* ProviderHost.ProviderHost;
  const accountReader = yield* CursorAccountReader.CursorAccountReader;
  const hostEnvironment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const crypto = yield* Crypto.Crypto;

  const cachePath = path.join(host.paths.stateDir, CURSOR_ACCOUNT_CACHE_FILE_NAME);
  const caches = new Map<string, CursorAccountCache>();
  let cacheDirty = false;
  /** Failed refreshes share the cache TTL to prevent repeated requests; null means no login. */
  const failures = new Map<string, { readonly atMs: number; readonly error: string | null }>();
  const refreshes = new Map<string, Deferred.Deferred<void>>();

  const ensureLoaded = yield* Effect.cached(
    fileSystem.readFileString(cachePath).pipe(
      Effect.flatMap((raw) => decodeCacheFile(raw)),
      Effect.catchCause(() => Effect.succeed(null)),
      Effect.map((document) => {
        for (const [key, cache] of decodeCursorAccountCaches(document)) caches.set(key, cache);
      }),
    ),
  );

  // Serialize snapshots; clear dirty before encoding and restore it on failure so changes retry.
  const persistLock = yield* Semaphore.make(1);
  const persist = Effect.gen(function* () {
    if (!cacheDirty) return;
    cacheDirty = false;
    yield* Effect.sync(() => encodeCursorAccountCaches(caches)).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath: cachePath, contents })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catchCause(() =>
        Effect.sync(() => {
          cacheDirty = true;
        }),
      ),
    );
  }).pipe(persistLock.withPermit, Effect.withSpan("CursorUsageAccounts.persist"));

  const pendingPersists = new Set<Fiber.Fiber<void>>();
  const schedulePersist = Effect.forkDetach(persist).pipe(
    Effect.map((fiber) => {
      pendingPersists.add(fiber);
      fiber.addObserver(() => pendingPersists.delete(fiber));
    }),
  );
  const awaitPersisted = Effect.suspend(() => Fiber.awaitAll([...pendingPersists])).pipe(
    Effect.asVoid,
  );
  yield* Effect.addFinalizer(() => awaitPersisted);

  const refreshAccount = Effect.fn("CursorUsageAccounts.refreshAccount")(function* (
    credential: CursorCredentialSource,
    credentialKey: string,
    retentionStartMs: number,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const fetchMissing = (cache: CursorAccountCache | undefined) => {
      const range = cursorFetchRange(cache, retentionStartMs, nowMs);
      return accountReader
        .read(credential, range.sinceMs, range.untilMs)
        .pipe(Effect.map((result) => ({ range, result })));
    };
    let base = caches.get(credentialKey);
    let fetched = yield* fetchMissing(base);
    if (
      base !== undefined &&
      fetched.result.accountKey !== null &&
      fetched.result.accountKey !== base.accountKey
    ) {
      caches.delete(credentialKey);
      cacheDirty = true;
      base = undefined;
      fetched = yield* fetchMissing(base);
    }
    const { range, result } = fetched;
    if (result.missing || result.error !== null || result.accountKey === null) {
      failures.set(credentialKey, {
        atMs: nowMs,
        error: result.missing || result.error !== null ? result.error : CURSOR_ACCOUNT_READ_ERROR,
      });
      yield* schedulePersist;
      return;
    }
    const merged = mergeCursorFetch(
      base,
      result.accountKey,
      range,
      result.records,
      nowMs,
      retentionStartMs,
    );
    caches.set(credentialKey, merged.cache);
    failures.delete(credentialKey);
    if (merged.changed) cacheDirty = true;
    yield* schedulePersist;
  });

  const startRefresh = (
    credential: CursorCredentialSource,
    credentialKey: string,
    retentionStartMs: number,
  ) =>
    // Enroll and fork atomically so interruption cannot strand a registered refresh.
    Effect.uninterruptible(
      Effect.gen(function* () {
        const current = refreshes.get(credentialKey);
        if (current !== undefined) return current;
        const done = Deferred.makeUnsafe<void>();
        refreshes.set(credentialKey, done);
        // Detached: a departing client must not cancel a fetch later reads reuse.
        yield* refreshAccount(credential, credentialKey, retentionStartMs).pipe(
          Effect.catchCause(() =>
            Clock.currentTimeMillis.pipe(
              Effect.map((atMs) =>
                failures.set(credentialKey, { atMs, error: CURSOR_ACCOUNT_READ_ERROR }),
              ),
            ),
          ),
          Effect.ensuring(
            Effect.suspend(() => {
              refreshes.delete(credentialKey);
              return Deferred.succeed(done, undefined);
            }),
          ),
          Effect.forkDetach,
        );
        return done;
      }),
    );

  const accountSource = Effect.fn("CursorUsageAccounts.accountSource")(function* (
    credential: CursorCredentialSource,
    dir: string,
    label: string | undefined,
    windowStartMs: number,
    retentionStartMs: number,
    awaitRefresh: boolean,
  ) {
    if (
      typeof credential === "string" &&
      !(yield* fileSystem.exists(credential).pipe(Effect.orElseSucceed(() => true)))
    ) {
      return null;
    }
    yield* ensureLoaded;
    const credentialKey =
      typeof credential === "string"
        ? credential
        : credential.kind === "keychain"
          ? "keychain"
          : `${API_KEY_CACHE_PREFIX}${yield* accountHash(
              `${credential.backendUrl}\0${credential.apiKey}`,
            ).pipe(Effect.provideService(Crypto.Crypto, crypto), Effect.orDie)}`;
    const nowMs = yield* Clock.currentTimeMillis;
    const recentFailure = failures.get(credentialKey);
    let refreshing = false;
    if (
      (recentFailure === undefined || nowMs - recentFailure.atMs >= CURSOR_ACCOUNT_TTL_MS) &&
      !isCursorCacheFresh(caches.get(credentialKey), nowMs)
    ) {
      const refresh = yield* startRefresh(credential, credentialKey, retentionStartMs);
      if (awaitRefresh) yield* Deferred.await(refresh);
      else refreshing = true;
    }

    const cache = caches.get(credentialKey);
    const failure = refreshing ? undefined : failures.get(credentialKey);
    const labelled = (message: string) => (label === undefined ? message : `${label}: ${message}`);
    const failureMessage =
      failure === undefined || failure.error === null ? failure?.error : labelled(failure.error);
    if (failureMessage === null) return null;
    if (cache === undefined) {
      return {
        credentialKey,
        source: {
          dir,
          ...(label === undefined ? {} : { volumeId: "" }),
          // Never combine a local fallback with another server's account-wide history.
          ...(refreshing
            ? { files: [], refreshing: true }
            : { files: null, message: failureMessage ?? labelled(CURSOR_ACCOUNT_READ_ERROR) }),
        } satisfies ProviderUsageScan,
      };
    }
    // Account history spans machines; a stable fingerprint prevents duplicate environment counts.
    const source = `cursor-account:${cache.accountKey}`;
    return {
      credentialKey,
      account: { key: cache.accountKey, fetchedAtMs: cache.fetchedAtMs },
      source: {
        dir: source,
        hostId: "cursor.com",
        volumeId: cache.accountKey,
        files: [
          {
            path: source,
            records: cache.records.filter((record) => record.timestampMs >= windowStartMs),
          },
        ],
        ...(failureMessage === undefined
          ? { status: "ok" }
          : { status: "partial", message: failureMessage }),
        ...(refreshing ? { refreshing: true } : {}),
      } satisfies ProviderUsageScan,
    };
  });

  const hostSource = Effect.fn("CursorUsageAccounts.hostSource")(function* (
    keychainUsageEnabled: boolean,
    hostKeyBilled: boolean,
    windowStartMs: number,
    retentionCutoffMs: number,
    awaitRefresh: boolean,
  ) {
    const home = yield* HostProcess.HomeDirectory;
    const userHome =
      (platform === "win32" ? hostEnvironment["USERPROFILE"] : hostEnvironment["HOME"]) || home;
    const configHome = hostEnvironment["XDG_CONFIG_HOME"]?.trim();
    const cursorHome =
      platform === "darwin"
        ? path.join(userHome, "Library", "Application Support")
        : platform === "win32"
          ? hostEnvironment["APPDATA"] || path.join(userHome, "AppData", "Roaming")
          : configHome && path.isAbsolute(configHome)
            ? configHome
            : path.join(userHome, ".config");
    const authPath =
      platform === "darwin"
        ? path.join(userHome, ".cursor", "auth.json")
        : path.join(cursorHome, platform === "win32" ? "Cursor" : "cursor", "auth.json");
    const credentialStore = hostEnvironment["AGENT_CLI_CREDENTIAL_STORE"];
    const tokenOrMemoryLogin =
      Boolean(hostEnvironment["CURSOR_AUTH_TOKEN"]?.trim()) || credentialStore === "memory";
    const loginUnavailable =
      tokenOrMemoryLogin || Boolean(hostEnvironment["CURSOR_API_KEY"]?.trim());
    const useKeychain = platform === "darwin" && credentialStore !== "file";
    if (useKeychain && !loginUnavailable && !keychainUsageEnabled) {
      return {
        source: {
          dir: authPath,
          volumeId: "",
          files: null,
          message: "Cursor account usage is off on this environment.",
          action: "enableCursorKeychain",
        } satisfies ProviderUsageScan,
      };
    }
    if (loginUnavailable) {
      // An instance source already reads the account the host CURSOR_API_KEY bills.
      if (hostKeyBilled && !tokenOrMemoryLogin) return null;
      return {
        source: {
          dir: authPath,
          files: null,
          message: "Cursor account history needs a Cursor CLI login on this server.",
        } satisfies ProviderUsageScan,
      };
    }
    return yield* accountSource(
      useKeychain ? { kind: "keychain" } : authPath,
      authPath,
      undefined,
      windowStartMs,
      retentionCutoffMs,
      awaitRefresh,
    );
  });

  /** The account an instance's own key bills; null when it has none and bills the host login. */
  const instanceSource = Effect.fn("CursorUsageAccounts.instanceSource")(function* (
    instance: CursorUsageInstance,
    windowStartMs: number,
    retentionCutoffMs: number,
    awaitRefresh: boolean,
  ) {
    const dir = `cursor-instance:${instance.instanceId}`;
    const unreadable = (message: string) => ({
      source: {
        dir,
        volumeId: "",
        files: null,
        message: `${instance.name}: ${message}`,
      } satisfies ProviderUsageScan,
    });
    const key = yield* makeCursorCredentialStore(instance.instanceId).pipe(
      Effect.flatMap(({ store }) =>
        readCursorBillingKey(instance.instanceId, instance.environment["CURSOR_API_KEY"], store),
      ),
      Effect.provideService(ProviderHost.ProviderHost, host),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.result,
    );
    if (Result.isFailure(key)) return unreadable(key.failure.detail);
    if (key.success === undefined) return null;
    if (key.success.expired) return unreadable("Sign in to Cursor again to read account usage.");
    return yield* accountSource(
      {
        kind: "apiKey",
        apiKey: key.success.apiKey,
        // Mirrors the in-process SDK, which reads the host's backend override, not the instance's.
        backendUrl: (
          key.success.backendUrl ??
          (hostEnvironment["CURSOR_BACKEND_URL"] || DEFAULT_CURSOR_BACKEND_URL)
        ).replace(/\/$/, ""),
      },
      dir,
      instance.name,
      windowStartMs,
      retentionCutoffMs,
      awaitRefresh,
    );
  });

  const scan: CursorUsageAccounts["Service"]["scan"] = Effect.fn("CursorUsageAccounts.scan")(
    function* ({
      instances,
      keychainUsageEnabled,
      windowStartMs,
      retentionCutoffMs,
      awaitRefresh,
    }) {
      const hostKey = hostEnvironment["CURSOR_API_KEY"]?.trim();
      const hostKeyBilled =
        Boolean(hostKey) &&
        instances.some((instance) => instance.environment["CURSOR_API_KEY"]?.trim() === hostKey);
      const [hostEntry, instanceEntries] = yield* Effect.all(
        [
          hostSource(
            keychainUsageEnabled,
            hostKeyBilled,
            windowStartMs,
            retentionCutoffMs,
            awaitRefresh,
          ),
          Effect.forEach(
            instances,
            (instance) => instanceSource(instance, windowStartMs, retentionCutoffMs, awaitRefresh),
            { concurrency: "unbounded" },
          ),
        ],
        { concurrency: "unbounded" },
      );

      // Drop history cached for API keys no instance bills any more, such as rotated keys.
      const billedKeys = new Set(
        instanceEntries.flatMap((entry) =>
          entry !== null && "credentialKey" in entry ? [entry.credentialKey] : [],
        ),
      );
      yield* ensureLoaded;
      for (const credentialKey of caches.keys()) {
        if (credentialKey.startsWith(API_KEY_CACHE_PREFIX) && !billedKeys.has(credentialKey)) {
          caches.delete(credentialKey);
          cacheDirty = true;
        }
      }
      if (cacheDirty) yield* schedulePersist;

      // Two credentials on one account share a fingerprint; keep the readable, freshest read.
      const sources: ProviderUsageScan[] = [];
      const accounts = new Map<
        string,
        { readonly index: number; readonly ok: boolean; readonly fetchedAtMs: number }
      >();
      for (const entry of [hostEntry, ...instanceEntries]) {
        if (entry === null) continue;
        const source: ProviderUsageScan = entry.source;
        const account = "account" in entry ? entry.account : undefined;
        if (account === undefined) {
          sources.push(source);
          continue;
        }
        const { key, fetchedAtMs } = account;
        const ok = source.status === "ok";
        const seen = accounts.get(key);
        if (
          seen === undefined ||
          (ok && !seen.ok) ||
          (ok === seen.ok && fetchedAtMs > seen.fetchedAtMs)
        ) {
          const index = seen?.index ?? sources.length;
          accounts.set(key, { index, ok, fetchedAtMs });
          sources[index] = source;
        }
      }
      return sources;
    },
  );

  return CursorUsageAccounts.of({ scan, awaitPersisted });
});

export const layer = Layer.effect(CursorUsageAccounts, make);
