import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("~/lib/runtime"), async (importOriginal) => ({
  ...(await importOriginal()),
  runPrimaryHttp: (() =>
    Promise.resolve({ kind: "redirect", url: "https://agent.test/callback" })) as never,
}));

import { loadConnectAgentEntry } from "./ConnectAgentSurface";

function stubWindowLocation(replace: () => void) {
  vi.stubGlobal("window", { location: { replace } });
  return { [Symbol.dispose]: () => vi.unstubAllGlobals() };
}

describe("loadConnectAgentEntry", () => {
  it("leaves a server redirect to the mounted surface", async () => {
    // Throwing turns a loader that navigates (and then never settles) into a rejection.
    const replace = vi.fn(() => {
      throw new Error("the loader navigated away");
    });
    using _window = stubWindowLocation(replace);

    const entry = loadConnectAgentEntry("?client_id=agent");

    // A route the user already left must not send the browser away.
    await expect(entry.loaded).resolves.toEqual({
      status: "redirect",
      url: "https://agent.test/callback",
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
