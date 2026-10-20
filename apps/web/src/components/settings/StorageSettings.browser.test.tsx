import { RegistryProvider } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type StorageCleanupReport,
} from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_SERVER_SETTINGS,
  run: vi.fn(),
  update: vi.fn(),
  report: null as StorageCleanupReport | null,
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const report = Atom.make(() => ({ _tag: "Success", value: state.report, waiting: false }));
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      storageCleanupReport: (() => report) as never,
      runStorageCleanup: {
        ...actual.serverEnvironment.runStorageCleanup,
        permissionAtom: () => allowed,
      },
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.run) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environment = {
      environmentId: "env",
      label: "Build workstation",
      serverConfig: {
        settings: state.settings,
        environment: {
          capabilities: {
            storageCleanup: true,
            storageCleanupRun: true,
            settledWorktreeCleanup: true,
          },
        },
      },
    };
    return {
      scope: { kind: "environment" },
      environments: [environment],
      connectedEnvironments: [environment],
      targets: [],
      target: null,
    };
  }) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => state.update,
  useClearScopedSettings: () => vi.fn(),
}));
// The real page container needs a router and the real row reads write permission and
// overrides from live environment state; this suite is about the cleanup panel.
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: (({ children }: { children: ReactNode }) => children) as never,
  SettingsRow: ({ title, description, control, children }) => (
    <div>
      <h3>{title}</h3>
      {description}
      {control}
      {children}
    </div>
  ),
  SettingResetButton: (() => null) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: vi.fn() } };
});

import { StorageSettingsPanel } from "./StorageSettings";

let root: Root;
let container: HTMLDivElement;

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  prototype?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    storageCleanup: {
      worktreeKeepWhen: "uncommitted-changes",
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
      worktreeOnMerge: false,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
    },
    projectSettingsOverrides: {},
  };
  state.report = null;
  state.run.mockReset();
  state.update.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <RegistryProvider>
        <StorageSettingsPanel />
      </RegistryProvider>,
    ),
  );
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Delete now",
  )!;
}

it.each(["machine-wide immediate", "project custom"])(
  "runs cleanup when only %s settled retention is enabled",
  async (scope) => {
    if (scope === "machine-wide immediate") {
      state.settings = {
        ...state.settings,
        storageCleanup: { ...state.settings.storageCleanup, worktreeSettledAfterDays: 0 },
      };
    } else {
      state.settings = {
        ...state.settings,
        projectSettingsOverrides: {
          [ProjectId.make("project")]: {
            worktreeCleanup: {
              mode: "custom",
              rules: { ...state.settings.storageCleanup, worktreeSettledAfterDays: 7 },
            },
          },
        },
      };
    }
    const report: StorageCleanupReport = {
      trigger: "manual",
      startedAt: "2026-10-14T12:00:00.000Z",
      finishedAt: "2026-10-14T12:00:01.000Z",
      entries: [],
      counts: { removed: 0, kept: 0, failed: 0 },
      omittedCount: 0,
      bytesFreed: 0,
    };
    let complete!: (result: { _tag: "Success"; value: StorageCleanupReport }) => void;
    state.run.mockImplementation(() => new Promise((resolve) => (complete = resolve)));
    const button = await render();

    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(state.run).toHaveBeenCalledExactlyOnceWith({ environmentId: "env", input: {} });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Deleting…");

    await act(async () => complete({ _tag: "Success", value: report }));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Delete now");
  },
);

const RETENTION_RULES = [
  ["Delete inactive worktrees", "worktreeAfterDays"],
  ["Delete settled worktrees", "worktreeSettledAfterDays"],
  ["Delete old browser artifacts", "browserArtifactsAfterDays"],
  ["Delete old rotated logs", "logsAfterDays"],
] as const;

function retentionSwitch(label: string) {
  const element = container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
  if (!element) throw new Error(`Missing switch ${label}`);
  return element;
}

function daysInput(label: string) {
  return container.querySelector<HTMLInputElement>(`input[aria-label="${label} in days"]`);
}

it.each(RETENTION_RULES)("turning %s on does not save 8 days", async (label) => {
  await render();

  await act(async () => retentionSwitch(label).click());

  expect(state.update).not.toHaveBeenCalled();
  expect(retentionSwitch(label).getAttribute("aria-checked")).toBe("true");
  expect(daysInput(label)?.value).toBe("8");
});

it("saves a drafted retention age only when that age is committed", async () => {
  const label = "Delete inactive worktrees";
  await render();
  await act(async () => retentionSwitch(label).click());
  const input = daysInput(label)!;

  await act(async () => {
    setInputValue(input, "30");
    input.blur();
  });

  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { worktreeAfterDays: 30 },
  });
  expect(daysInput(label)?.value).toBe("30");
});

it("saves the visible default when Enter commits an untouched retention draft", async () => {
  const label = "Delete inactive worktrees";
  await render();
  await act(async () => retentionSwitch(label).click());

  await act(async () => {
    daysInput(label)?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });

  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { worktreeAfterDays: 8 },
  });
});

it("keeps a retention rule off when its draft is left or cancelled", async () => {
  const label = "Delete inactive worktrees";
  await render();
  await act(async () => retentionSwitch(label).click());
  const outside = document.createElement("button");
  document.body.append(outside);

  await act(async () => outside.focus());

  expect(state.update).not.toHaveBeenCalled();
  expect(daysInput(label)).toBeNull();
  outside.remove();

  await act(async () => retentionSwitch(label).click());
  await act(async () => {
    daysInput(label)?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });

  expect(state.update).not.toHaveBeenCalled();
  expect(daysInput(label)).toBeNull();
});

it("saves a retention step from the drafted age", async () => {
  const label = "Delete old rotated logs";
  await render();
  await act(async () => retentionSwitch(label).click());

  await act(async () => {
    container.querySelector<HTMLElement>(`[aria-label="Increase ${label}"]`)?.click();
  });

  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { logsAfterDays: 9 },
  });
});

it("turns an enabled retention rule off immediately and edits it without saving 8", async () => {
  const label = "Delete old browser artifacts";
  state.settings = {
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, browserArtifactsAfterDays: 30 },
  };
  await render();
  const input = daysInput(label)!;

  await act(async () => {
    input.focus();
    setInputValue(input, "14");
    input.blur();
  });
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { browserArtifactsAfterDays: 14 },
  });

  state.update.mockClear();
  await act(async () => retentionSwitch(label).click());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { browserArtifactsAfterDays: null },
  });
});

it("keeps cleanup disabled when settled retention and all other rules are off", async () => {
  const button = await render();

  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(state.run).not.toHaveBeenCalled();
});

it("shows orphan sizes and identifies failed worktrees with one connected machine", async () => {
  state.settings = {
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, worktreeSettledAfterDays: 0 },
  };
  state.report = {
    trigger: "manual",
    startedAt: "2026-10-14T12:00:00.000Z",
    finishedAt: "2026-10-14T12:00:01.000Z",
    entries: [
      {
        kind: "worktree",
        outcome: "kept",
        path: "/worktrees/repo/orphan",
        projectPath: null,
        threadId: null,
        threadTitle: null,
        reason: "No thread uses this folder, and it isn't a git worktree",
        bytes: 6600000,
        files: null,
      },
      {
        kind: "worktree",
        outcome: "failed",
        path: "/worktrees/repo/thread-checkout",
        projectPath: "/projects/repo",
        threadId: ThreadId.make("thread"),
        threadTitle: "Thread title",
        reason: "Git index is locked. Status will resume when the index lock is removed.",
        bytes: null,
        files: null,
      },
    ],
    counts: { removed: 0, kept: 1, failed: 1 },
    omittedCount: 0,
    bytesFreed: 0,
  };
  await render();
  const lastRun = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Last run"),
  )!;
  await act(async () => lastRun.click());
  const titles = Array.from(container.querySelectorAll("h3"), (heading) => heading.textContent);
  expect(titles).toContain("/worktrees/repo/orphan");
  expect(titles).toContain("thread-checkout");
  const failedRow = page.elementLocator(
    page.getByRole("heading", { name: "thread-checkout", exact: true }).element().parentElement!,
  );
  await expect.element(failedRow.getByText("Build workstation", { exact: true })).toBeVisible();
  await expect.element(failedRow.getByText("/projects/repo", { exact: true })).toBeVisible();
  await expect
    .element(failedRow.getByText("/worktrees/repo/thread-checkout", { exact: true }))
    .toBeVisible();
  await expect.element(failedRow.getByText("Thread title", { exact: true })).toBeVisible();
  await expect
    .element(
      failedRow.getByText(
        "Git index is locked. Status will resume when the index lock is removed.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(titles).not.toContain("/worktrees/repo/thread-checkout");
  expect(container.textContent).toContain(
    "No thread uses this folder, and it isn't a git worktree",
  );
  expect(container.textContent).toContain("6.29 MB");
  expect(container.textContent).toContain("0 B recovered.");
});
