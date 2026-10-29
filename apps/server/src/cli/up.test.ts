import { expect, it } from "@effect/vitest";

import { upPortCheck, upsertServiceEnv } from "./up.ts";

it("rewrites only the service.env keys t3 up owns and keeps the user's lines", () => {
  const before = [
    "# my settings",
    "T3CODE_PORT=4000",
    "export T3CODE_TAILSCALE_ONLY=0",
    "T3CODE_TAILSCALE_OWNER=123",
    "T3CODE_TAILSCALE_ONLY=0",
    "",
  ].join("\n");
  expect(
    upsertServiceEnv(before, {
      T3CODE_TAILSCALE_SIGN_IN: "1",
      T3CODE_TAILSCALE_ONLY: "1",
      T3CODE_TAILSCALE_OWNER: undefined,
    }),
  ).toBe(
    [
      "# my settings",
      "T3CODE_PORT=4000",
      "T3CODE_TAILSCALE_ONLY=1",
      "T3CODE_TAILSCALE_SIGN_IN=1",
      "",
    ].join("\n"),
  );
  expect(upsertServiceEnv("", { T3CODE_TAILSCALE_SIGN_IN: "1" })).toBe(
    "T3CODE_TAILSCALE_SIGN_IN=1\n",
  );
});

const SERVICE = { port: 3773, serviceManaged: true };
const MANUAL = { port: 3773, serviceManaged: false };

it.each([
  { configuredPort: undefined, free: true, running: null, expected: "ok" },
  { configuredPort: undefined, free: false, running: SERVICE, expected: "ok" },
  { configuredPort: undefined, free: false, running: null, expected: "taken" },
  { configuredPort: undefined, free: false, running: MANUAL, expected: "manual" },
  { configuredPort: "3773", free: false, running: null, expected: "ok" },
  { configuredPort: "4000", free: true, running: null, expected: "custom" },
  { configuredPort: "4000", free: true, running: { ...MANUAL, port: 4000 }, expected: "manual" },
] as const)(
  "port check with T3CODE_PORT=$configuredPort, free=$free, running=$running is $expected",
  ({ configuredPort, free, running, expected }) => {
    expect(upPortCheck({ configuredPort, defaultPortFree: free, running })).toBe(expected);
  },
);
