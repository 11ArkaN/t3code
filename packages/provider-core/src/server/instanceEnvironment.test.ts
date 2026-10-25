import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { makeInjectedSecrets, mergeProviderInstanceEnvironment } from "./instanceEnvironment.ts";

describe("mergeProviderInstanceEnvironment", () => {
  it.effect.each([
    { value: "~/.account", tail: ".account" },
    { value: "~\\.account\\work", tail: ".account\\work" },
  ])("expands configured provider homes set to $value", ({ value, tail }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const baseEnv = {
        CODEX_HOME: "~/.inherited-codex",
        CLAUDE_CONFIG_DIR: "~/.inherited-claude",
      };
      const environment = yield* mergeProviderInstanceEnvironment(
        [
          { name: "CODEX_HOME", value, sensitive: false },
          { name: "CLAUDE_CONFIG_DIR", value, sensitive: false },
          { name: "CUSTOM_VALUE", value, sensitive: false },
        ],
        baseEnv,
      );

      expect(environment).toEqual({
        CODEX_HOME: path.join("/home/ada", tail),
        CLAUDE_CONFIG_DIR: path.join("/home/ada", tail),
        CUSTOM_VALUE: value,
      });
      expect(baseEnv).toEqual({
        CODEX_HOME: "~/.inherited-codex",
        CLAUDE_CONFIG_DIR: "~/.inherited-claude",
      });
    }).pipe(
      Effect.provideService(HostProcess.HomeDirectory, "/home/ada"),
      Effect.provide(NodeServices.layer),
    ),
  );

  it.effect("leaves inherited provider homes unchanged", () =>
    Effect.gen(function* () {
      const baseEnv = { CODEX_HOME: "~/.codex", CLAUDE_CONFIG_DIR: "~\\.claude" };

      expect(
        yield* mergeProviderInstanceEnvironment(
          [{ name: "CUSTOM_VALUE", value: "~/.custom", sensitive: false }],
          baseEnv,
        ),
      ).toEqual({ ...baseEnv, CUSTOM_VALUE: "~/.custom" });
    }),
  );

  it.effect("overrides inherited environment values and preserves empty strings", () =>
    Effect.gen(function* () {
      expect(
        yield* mergeProviderInstanceEnvironment(
          [
            { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
            { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
          ],
          { ANTHROPIC_API_KEY: "inherited", PATH: "/bin" },
        ),
      ).toMatchObject({
        OPENROUTER_API_KEY: "sk-or-test",
        ANTHROPIC_API_KEY: "",
        PATH: "/bin",
      });
    }),
  );
});

describe("makeInjectedSecrets", () => {
  it("replaces every exact value once, without rescanning the markers it inserts", () => {
    const secrets = makeInjectedSecrets();
    secrets.put("instance", [
      { name: "PIN", value: "42" },
      { name: "TOKEN", value: "redacted" },
      { name: "LONG", value: "abc-redacted-xyz" },
    ]);

    expect(secrets.redactText("pin=42 long=abc-redacted-xyz token=redacted 4 2")).toBe(
      "pin=[redacted PIN] long=[redacted LONG] token=[redacted TOKEN] 4 2",
    );
    const redacted = secrets.redact(JSON.parse('{"42":"redacted","__proto__":{"a":"42"},"n":7}'));
    expect(JSON.stringify(redacted)).toBe(
      '{"[redacted PIN]":"[redacted TOKEN]","__proto__":{"a":"[redacted PIN]"},"n":7}',
    );
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
  });

  it("replaces a value split across chunks and releases tails that never complete it", () => {
    const secrets = makeInjectedSecrets();
    secrets.put("instance", [{ name: "KEY", value: "s3cret-value" }]);

    const first = secrets.redactChunk("", "KEY=s3cr");
    expect(first).toEqual({ emit: "KEY=", pending: "s3cr" });
    const second = secrets.redactChunk(first.pending, "et-value\nnext s3");
    expect(second).toEqual({ emit: "[redacted KEY]\nnext ", pending: "s3" });
    expect(secrets.redactChunk(second.pending, "x")).toEqual({ emit: "s3x", pending: "" });
  });
});
