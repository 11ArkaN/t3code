import type { ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { expandHomePath } from "./pathExpansion.ts";
import type { ProviderAdapterV2 } from "./ProviderAdapter.ts";

export const mergeProviderInstanceEnvironment = Effect.fn(function* (
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  if (!environment || environment.length === 0) {
    return baseEnv;
  }

  const home = yield* HostProcess.HomeDirectory;
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    next[variable.name] =
      variable.name === "CODEX_HOME" || variable.name === "CLAUDE_CONFIG_DIR"
        ? expandHomePath(variable.value, home)
        : variable.value;
  }
  return next;
});

export interface InjectedSecret {
  readonly name: string;
  readonly value: string;
}

const redactionMarker = (name: string) => `[redacted ${name}]`;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact values T3 injects into provider processes, replaced by named markers in tool output and logs. */
export class InjectedSecrets extends Context.Reference<{
  readonly put: (key: unknown, secrets: ReadonlyArray<InjectedSecret>) => void;
  readonly remove: (key: unknown) => void;
  readonly redactText: (text: string) => string;
  /** Rebuilds plain objects and arrays only where a string or key changed. */
  readonly redact: <A>(value: A) => A;
  /** Holds back a raw tail that could begin a secret, so a value split across chunks is still replaced. */
  readonly redactChunk: (
    pending: string,
    chunk: string,
  ) => { readonly emit: string; readonly pending: string };
}>("@t3tools/provider-core/server/InjectedSecrets", {
  // Without the layer nothing is registered, so there is nothing to redact.
  defaultValue: () => ({
    put: () => {},
    remove: () => {},
    redactText: (text) => text,
    redact: (value) => value,
    redactChunk: (pending, chunk) => ({ emit: pending + chunk, pending: "" }),
  }),
}) {
  static readonly layer = Layer.sync(InjectedSecrets, () => makeInjectedSecrets());
}

export function makeInjectedSecrets(): (typeof InjectedSecrets)["Service"] {
  const byKey = new Map<unknown, ReadonlyArray<InjectedSecret>>();
  let names = new Map<string, string>();
  // Literal alternation, longest first: one left-to-right pass, so markers are never rescanned.
  let pattern: RegExp | undefined;
  const rebuild = () => {
    names = new Map();
    for (const secrets of byKey.values()) {
      for (const secret of secrets) {
        if (secret.value.length > 0) names.set(secret.value, secret.name);
      }
    }
    const values = [...names.keys()].sort((a, b) => b.length - a.length);
    pattern = values.length === 0 ? undefined : new RegExp(values.map(escapeRegExp).join("|"), "g");
  };
  const marker = (value: string) => redactionMarker(names.get(value)!);
  const redactText = (text: string) => (pattern ? text.replace(pattern, marker) : text);
  const redactUnknown = (value: unknown): unknown => {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((entry) => {
        const redacted = redactUnknown(entry);
        if (redacted !== entry) changed = true;
        return redacted;
      });
      return changed ? next : value;
    }
    if (value === null || typeof value !== "object") return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    let changed = false;
    const entries = Object.entries(value).map(([key, entry]) => {
      const redactedKey = redactText(key);
      const redacted = redactUnknown(entry);
      if (redactedKey !== key || redacted !== entry) changed = true;
      return [redactedKey, redacted] as const;
    });
    // fromEntries defines own data properties, so a "__proto__" key stays a key.
    return changed ? Object.fromEntries(entries) : value;
  };
  return {
    put: (key, secrets) => {
      byKey.set(key, secrets);
      rebuild();
    },
    remove: (key) => {
      if (byKey.delete(key)) rebuild();
    },
    redactText,
    redact: <A>(value: A): A => (pattern ? (redactUnknown(value) as A) : value),
    redactChunk: (pending, chunk) => {
      const text = pending + chunk;
      if (!pattern) return { emit: text, pending: "" };
      let emit = "";
      let end = 0;
      for (const match of text.matchAll(pattern)) {
        emit += text.slice(end, match.index) + marker(match[0]);
        end = match.index + match[0].length;
      }
      let hold = text.length;
      for (const value of names.keys()) {
        let index = text.indexOf(value[0]!, Math.max(end, text.length - value.length + 1));
        while (index !== -1 && index < hold) {
          if (value.startsWith(text.slice(index))) {
            hold = index;
            break;
          }
          index = text.indexOf(value[0]!, index + 1);
        }
      }
      return { emit: emit + text.slice(end, hold), pending: text.slice(hold) };
    },
  };
}

/** Sessions keep redacting the values they launched with, even after the instance is reconfigured. */
export const withSensitiveEnvironment = Effect.fn("instanceEnvironment.withSensitiveEnvironment")(
  function* (adapter: ProviderAdapterV2["Service"], environment: ProviderInstanceEnvironment) {
    const secrets = environment.filter((variable) => variable.sensitive);
    if (secrets.length === 0) return adapter;
    const injected = yield* InjectedSecrets;
    return {
      ...adapter,
      openSession: (input) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const key = {};
            injected.put(key, secrets);
            return key;
          }),
          (key) => Effect.sync(() => injected.remove(key)),
        ).pipe(Effect.andThen(adapter.openSession(input))),
    } satisfies ProviderAdapterV2["Service"];
  },
);
