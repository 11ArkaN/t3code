import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import { isCodexAuthRefreshDue, openCodexAuthRefresh } from "./CodexAuthRefresh.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NOW_MS = Date.UTC(2026, 9, 27);

const jwt = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

const authJson = (input: {
  readonly authMode?: string | null;
  readonly apiKey?: string | null;
  readonly accessToken?: string | null;
  readonly lastRefreshMs?: number;
}) =>
  JSON.stringify({
    ...(input.authMode === null ? {} : { auth_mode: input.authMode ?? "chatgpt" }),
    OPENAI_API_KEY: input.apiKey ?? null,
    ...(input.accessToken === null
      ? {}
      : {
          tokens: {
            id_token: jwt({}),
            access_token: input.accessToken ?? jwt({}),
            refresh_token: "refresh",
            account_id: "account",
          },
        }),
    ...(input.lastRefreshMs === undefined
      ? {}
      : { last_refresh: DateTime.formatIso(DateTime.makeUnsafe(input.lastRefreshMs)) }),
  });

const expiringIn = (ms: number) => jwt({ exp: (NOW_MS + ms) / 1000 });

describe("isCodexAuthRefreshDue", () => {
  it.each([
    ["exp 20 minutes out", authJson({ accessToken: expiringIn(20 * MINUTE_MS) }), false],
    ["exp 14 minutes out", authJson({ accessToken: expiringIn(14 * MINUTE_MS) }), true],
    ["exp already passed", authJson({ accessToken: expiringIn(-MINUTE_MS) }), true],
    [
      "exp wins over an old last_refresh",
      authJson({ accessToken: expiringIn(DAY_MS), lastRefreshMs: NOW_MS - 30 * DAY_MS }),
      false,
    ],
    ["no exp, refreshed 7 days ago", authJson({ lastRefreshMs: NOW_MS - 7 * DAY_MS }), false],
    [
      "no exp, refreshed 8 days minus 5 minutes ago",
      authJson({ lastRefreshMs: NOW_MS - 8 * DAY_MS + 5 * MINUTE_MS }),
      true,
    ],
    ["no exp and no last_refresh", authJson({}), false],
    [
      "inferred ChatGPT mode",
      authJson({ authMode: null, accessToken: expiringIn(MINUTE_MS) }),
      true,
    ],
    [
      "API key mode",
      authJson({ authMode: "apikey", apiKey: "key", accessToken: expiringIn(MINUTE_MS) }),
      false,
    ],
    [
      "inferred API key mode",
      authJson({ authMode: null, apiKey: "key", accessToken: expiringIn(MINUTE_MS) }),
      false,
    ],
    ["ChatGPT without tokens", authJson({ accessToken: null, lastRefreshMs: 0 }), false],
    ["unreadable file", "{", false],
  ])("%s", (_name, json, due) => {
    expect(isCodexAuthRefreshDue(json, NOW_MS)).toBe(due);
  });
});

it.layer(NodeServices.layer)("openCodexAuthRefresh", (it) => {
  it.effect("refreshes a due home through one of the app-servers opening on it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const authPath = path.join(yield* fileSystem.makeTempDirectoryScoped(), "auth.json");
      // TestClock starts at epoch 0, so exp is relative to 0.
      yield* fileSystem.writeFileString(authPath, authJson({ accessToken: jwt({ exp: 60 }) }));
      const refreshes = yield* Ref.make(0);
      const refresh = Ref.update(refreshes, (count) => count + 1).pipe(
        Effect.andThen(
          fileSystem.writeFileString(
            authPath,
            authJson({ accessToken: jwt({ exp: 10 * 86_400 }) }),
          ),
        ),
      );
      const openSession = Effect.scoped(
        openCodexAuthRefresh(authPath).pipe(
          Effect.flatMap((authRefresh) => authRefresh.start(refresh)),
        ),
      );

      yield* Effect.all([openSession, openSession, openSession], { concurrency: "unbounded" });

      expect(yield* Ref.get(refreshes)).toBe(1);
    }),
  );
});
