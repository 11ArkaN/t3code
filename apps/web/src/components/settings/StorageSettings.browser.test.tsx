import { act, render } from "../../../test/render";
import { RegistryProvider } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS, type StorageCleanupReport } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

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

function setup() {
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
}

const panel = () => (
  <RegistryProvider>
    <StorageSettingsPanel />
  </RegistryProvider>
);
const deleteButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Delete now",
  )!;

const RETENTION_RULES = [
  ["Delete inactive worktrees", "worktreeAfterDays"],
  ["Delete settled worktrees", "worktreeSettledAfterDays"],
  ["Delete old browser artifacts", "browserArtifactsAfterDays"],
  ["Delete old rotated logs", "logsAfterDays"],
] as const;
const inactive = "Delete inactive worktrees";

function ruleSwitch(root: ParentNode, label: string) {
  return root.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`)!;
}
function daysInput(root: ParentNode, label: string) {
  return root.querySelector<HTMLInputElement>(`input[aria-label="${label} in days"]`);
}
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function pressKey(input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
async function openDraft(label: string) {
  const screen = await render(panel());
  await act(async () => ruleSwitch(screen.container, label).click());
  return screen;
}

it.each(RETENTION_RULES)("turning %s on does not save 8 days", async (label) => {
  setup();
  await using screen = await openDraft(label);
  expect(state.update).not.toHaveBeenCalled();
  expect(ruleSwitch(screen.container, label).getAttribute("aria-checked")).toBe("true");
  expect(daysInput(screen.container, label)?.value).toBe("8");
});

it("saves a drafted retention age only when that age is committed", async () => {
  setup();
  await using screen = await openDraft(inactive);
  const input = daysInput(screen.container, inactive)!;
  await act(async () => {
    setInputValue(input, "30");
    input.blur();
  });
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { worktreeAfterDays: 30 },
  });
  expect(daysInput(screen.container, inactive)?.value).toBe("30");
});

it("saves the visible default when Enter commits an untouched retention draft", async () => {
  setup();
  await using screen = await openDraft(inactive);
  await act(async () => pressKey(daysInput(screen.container, inactive)!, "Enter"));
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { worktreeAfterDays: 8 },
  });
});

it("commits the parsed retention age when Enter is pressed on grouped text", async () => {
  setup();
  await using screen = await openDraft(inactive);
  const input = daysInput(screen.container, inactive)!;
  await act(async () => setInputValue(input, "1000"));
  input.value = "1.000";
  await act(async () => pressKey(input, "Enter"));
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { worktreeAfterDays: 1000 },
  });
});

it("returns a retention rule to off when saving its age fails", async () => {
  setup();
  state.update.mockResolvedValue(false);
  await using screen = await openDraft(inactive);
  const input = daysInput(screen.container, inactive)!;
  await act(async () => {
    setInputValue(input, "30");
    input.blur();
  });
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { worktreeAfterDays: 30 },
  });
  expect(daysInput(screen.container, inactive)).toBeNull();
});

it("keeps a retention rule off when its draft is left or cancelled", async () => {
  setup();
  await using screen = await openDraft(inactive);
  const outside = document.createElement("button");
  document.body.append(outside);
  await act(async () => outside.focus());
  expect(state.update).not.toHaveBeenCalled();
  expect(daysInput(screen.container, inactive)).toBeNull();
  outside.remove();
  await act(async () => ruleSwitch(screen.container, inactive).click());
  await act(async () => pressKey(daysInput(screen.container, inactive)!, "Escape"));
  expect(state.update).not.toHaveBeenCalled();
  expect(daysInput(screen.container, inactive)).toBeNull();
});

it("saves a retention step from the drafted age", async () => {
  const label = "Delete old rotated logs";
  setup();
  await using screen = await openDraft(label);
  const step = screen.container.querySelector<HTMLElement>(`[aria-label="Increase ${label}"]`)!;
  await act(async () => step.click());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { logsAfterDays: 9 },
  });
});

it("does not save a drafted age when that rule's switch is clicked", async () => {
  setup();
  await using screen = await openDraft(inactive);
  const input = daysInput(screen.container, inactive)!;
  const toggle = ruleSwitch(screen.container, inactive);
  await act(async () => setInputValue(input, "30"));
  await act(async () => {
    toggle.focus();
    toggle.click();
  });
  expect(state.update).not.toHaveBeenCalled();
  expect(daysInput(screen.container, inactive)).toBeNull();
});

it("turns an enabled retention rule off immediately and edits it without saving 8", async () => {
  const label = "Delete old browser artifacts";
  setup();
  state.settings = {
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, browserArtifactsAfterDays: 30 },
  };
  await using screen = await render(panel());
  const input = daysInput(screen.container, label)!;
  await act(async () => {
    input.focus();
    setInputValue(input, "14");
    input.blur();
  });
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { browserArtifactsAfterDays: 14 },
  });
  state.update.mockClear();
  await act(async () => ruleSwitch(screen.container, label).click());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    storageCleanup: { browserArtifactsAfterDays: null },
  });
});

it("keeps cleanup disabled when settled retention and all other rules are off", async () => {
  setup();
  await using screen = await render(panel());
  const button = deleteButton(screen.container);

  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(state.run).not.toHaveBeenCalled();
});
