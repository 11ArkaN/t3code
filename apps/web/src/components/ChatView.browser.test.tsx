import { createMemoryHistory } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, fakeTimers, render } from "../../test/render";

// As in test/appScenarios.renders.tsx: the socket is the only fake layer.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const TURNS = 2;
const THREADS = ["thread-a", "thread-b"].map((name) => threadWithHistory(name, TURNS));
const [A, B] = THREADS.map((thread) => thread.id) as [ThreadId, ThreadId];

installFakeEnvironment(THREADS);
// A landscape tablet: wide enough for the desktop layout, above the max-sm breakpoint.
await page.viewport(1163, 900);
__setClientSettingsForTests({
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
});

const lastAnswer = (threadId: ThreadId) => page.getByText(`Answer ${TURNS - 1} for ${threadId}.`);

async function mountApp(threadId: ThreadId) {
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threadId}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 1163px;";
  const screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect.element(lastAnswer(threadId)).toBeVisible();
  return screen;
}

// Chromium's touch emulation makes (pointer: coarse) and (hover: none) match.
async function emulateTouchPrimaryDevice(): Promise<AsyncDisposable> {
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return {
    [Symbol.asyncDispose]: async () => {
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
    },
  };
}

it("leaves focus off the composer after tapping another thread on a touch-primary device", async () => {
  await using _touch = await emulateTouchPrimaryDevice();
  expect(window.matchMedia("(pointer: coarse) and (hover: none)").matches).toBe(true);
  await using _app = await mountApp(A);
  using _timers = fakeTimers();

  const row = page.getByRole("treeitem", { name: /Thread thread-b/ });
  await userEvent.click(row);
  await expect.element(lastAnswer(B)).toBeVisible();
  await expect.element(row).toHaveFocus();
  // The thread switch focuses the composer one frame after it renders.
  act(() => {
    vi.advanceTimersToNextFrame();
  });

  // On a phone or tablet a focused editor raises the on-screen keyboard.
  expect(
    document.activeElement?.closest('[data-testid="composer-editor"]'),
    "a touch thread switch focused the composer editor",
  ).toBeNull();
});
