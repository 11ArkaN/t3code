import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type DesktopPreviewBridge,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  registerWebview: vi.fn<DesktopPreviewBridge["registerWebview"]>(),
  getPreviewConfig: vi.fn<DesktopPreviewBridge["getPreviewConfig"]>(),
}));

vi.mock(import("~/env"), async (original) => ({ ...(await original()), isElectron: true }));

vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));

vi.mock(import("~/localApi"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    ensureLocalApi: () => ({ ...actual.ensureLocalApi(), persistence: mocks as never }),
  };
});

// The Electron desktop bridge; a browser has none.
vi.mock(import("~/components/preview/previewBridge"), async (original) => ({
  ...(await original()),
  previewBridge: {
    createTab: mocks.createTab,
    closeTab: mocks.closeTab,
    registerWebview: mocks.registerWebview,
    getPreviewConfig: mocks.getPreviewConfig,
  } as never,
}));

vi.mock(import("~/components/preview/usePreviewBridge"), async (original) => ({
  ...(await original()),
  usePreviewBridge: () => undefined,
}));

import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
} from "~/hooks/useSettings";
import { reconcilePreviewServerSessions, resetPreviewStateForTests } from "~/previewStateStore";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { acquireBrowserSurface } from "./browserSurfaceStore";
import { ElectronBrowserHost } from "./ElectronBrowserHost";

const threadRef = scopeThreadRef(
  EnvironmentId.make("host-webview-order"),
  ThreadId.make("thread-webview-order"),
);

const snapshot = (tabId: string, updatedAt: string): PreviewSessionSnapshot => ({
  threadId: threadRef.threadId,
  tabId,
  navStatus: { _tag: "Success", url: `https://example.com/${tabId}`, title: tabId },
  canGoBack: false,
  canGoForward: false,
  updatedAt,
});

function setup(): Disposable {
  __resetClientSettingsPersistenceForTests();
  mocks.getClientSettings.mockReset().mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  mocks.setClientSettings.mockReset().mockResolvedValue(undefined);
  mocks.createTab.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset().mockResolvedValue(undefined);
  mocks.registerWebview.mockReset().mockResolvedValue(undefined);
  mocks.getPreviewConfig.mockReset().mockResolvedValue({
    partition: "persist:t3-preview-default",
    webPreferences: "contextIsolation=yes",
    preloadUrl: null,
  });
  return {
    [Symbol.dispose]() {
      resetPreviewStateForTests();
      __resetClientSettingsPersistenceForTests();
    },
  };
}

async function renderHost() {
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(
    await render(
      <AppAtomRegistryProvider>
        <ElectronBrowserHost />
      </AppAtomRegistryProvider>,
    ),
  );
  // Unmounting releases each tab on a close timer; run it now so it never fires in a later test.
  stack.defer(async () => {
    using _timers = fakeTimers();
    await screen.unmount();
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(() => ensureClientSettingsHydrated());
  const environment = stack.move();
  return { container: screen.container, [Symbol.asyncDispose]: () => environment.disposeAsync() };
}

describe("ElectronBrowserHost", () => {
  it("never moves a tab's webview when the server reorders tabs by last update", async () => {
    using _state = setup();
    reconcilePreviewServerSessions(threadRef, {
      sessions: [
        snapshot("tab_7", "2026-01-01T00:00:01.000Z"),
        snapshot("tab_8", "2026-01-01T00:00:02.000Z"),
      ],
      serverEpoch: "server-a",
      revision: 1,
    });
    await using screen = await renderHost();

    const host = screen.container.querySelector("[data-electron-browser-host]")!;
    const webviews = () => [...host.querySelectorAll("webview")];
    const before = webviews();
    expect(before.map((node) => node.getAttribute("data-preview-server-tab")).toSorted()).toEqual([
      "tab_7",
      "tab_8",
    ]);

    // Electron destroys a webview's guest when its element leaves the DOM, so a reorder that
    // detaches and re-inserts the element blanks the tab.
    const detached: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) detached.push(...record.removedNodes);
    });
    observer.observe(host, { childList: true, subtree: true });

    await act(async () => {
      reconcilePreviewServerSessions(threadRef, {
        sessions: [
          snapshot("tab_8", "2026-01-01T00:00:02.000Z"),
          snapshot("tab_7", "2026-01-01T00:00:03.000Z"),
        ],
        serverEpoch: "server-a",
        revision: 2,
      });
    });
    observer.takeRecords().forEach((record) => detached.push(...record.removedNodes));
    observer.disconnect();

    expect(detached).toEqual([]);
    const after = webviews();
    expect(after).toHaveLength(2);
    expect(after.every((node, index) => node.isSameNode(before[index]!))).toBe(true);
  });

  it("releases a preview's focus when the preview stops being shown", async () => {
    using _state = setup();
    // macOS keeps inactive previews paintable offscreen instead of hiding them.
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    reconcilePreviewServerSessions(threadRef, {
      sessions: [snapshot("tab_7", "2026-01-01T00:00:01.000Z")],
      serverEpoch: "server-a",
      revision: 1,
    });
    await using screen = await renderHost();

    const webview = screen.container.querySelector("webview")!;
    const surface = acquireBrowserSurface(webview.getAttribute("data-preview-tab")!);
    using _surface = { [Symbol.dispose]: surface.release };
    const rect = { x: 0, y: 0, width: 800, height: 600 };
    await act(async () => {
      surface.present(rect, true);
    });
    expect(webview.getAttribute("aria-hidden")).toBeNull();
    // Electron's <webview> takes host focus when its guest page does; a test browser's does not.
    webview.tabIndex = -1;
    webview.focus();
    expect(document.activeElement).toBe(webview);

    // Closing the panel or switching tabs keeps the webview mounted offscreen. A guest that keeps
    // focus there keeps its password field focused, which holds macOS Secure Event Input on.
    await act(async () => {
      surface.present(rect, false);
    });
    expect(webview.getAttribute("aria-hidden")).toBe("true");
    // Lay out first so Chromium's own focus fixup has run before the check.
    webview.getBoundingClientRect();

    expect(document.activeElement, "a hidden preview webview still holds focus").not.toBe(webview);
  });

  it("blurs a focused password field in a preview's page when focus moves into the app", async () => {
    using _state = setup();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    reconcilePreviewServerSessions(threadRef, {
      sessions: [snapshot("tab_7", "2026-01-01T00:00:01.000Z")],
      serverEpoch: "server-a",
      revision: 1,
    });
    await using screen = await renderHost();
    const webview = screen.container.querySelector("webview")!;

    // A same-origin frame stands in for the guest page, with its password field in a nested frame.
    // A frame drops its focused element when the host's focus moves and a guest page does not, so
    // the field stays focused and the guest's page focus is set by hand.
    const guestFrame = document.createElement("iframe");
    document.body.append(guestFrame);
    using _guestFrame = { [Symbol.dispose]: () => guestFrame.remove() };
    const guest = guestFrame.contentDocument!;
    let guestHasFocus = true;
    guest.hasFocus = () => guestHasFocus;
    guest.body.innerHTML = `<input id="search" /><iframe></iframe>`;
    const login = guest.querySelector("iframe")!.contentDocument!;
    login.body.innerHTML = `<input id="password" type="password" />`;
    const guestWindow = guestFrame.contentWindow as unknown as { eval: (code: string) => unknown };
    // Electron defers guest scripts while the page loads; the test runs each one when it chooses.
    const pendingScripts: Array<() => void> = [];
    webview.executeJavaScript = (code) =>
      new Promise((resolve) => pendingScripts.push(() => resolve(guestWindow.eval(code))));
    const runPendingScripts = () => {
      for (const run of pendingScripts.splice(0)) run();
    };
    const focusThenLeavePreview = (field: HTMLElement) => {
      field.focus();
      guestHasFocus = false;
      webview.dispatchEvent(new FocusEvent("blur"));
    };

    const search = guest.getElementById("search")!;
    focusThenLeavePreview(search);
    runPendingScripts();
    expect(guest.activeElement, "pages under test keep their non-password focus").toBe(search);

    const password = login.getElementById("password")!;
    focusThenLeavePreview(password);
    guestHasFocus = true;
    runPendingScripts();
    expect(login.activeElement, "a late script blurred a field the user went back to").toBe(
      password,
    );

    focusThenLeavePreview(password);
    runPendingScripts();
    expect(login.activeElement, "the guest kept its focused password field").not.toBe(password);
  });
});
