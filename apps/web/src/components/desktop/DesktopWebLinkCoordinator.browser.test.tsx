import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult, type Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../../test/render";

const state = vi.hoisted(() => ({
  projects: [] as never[],
  routeParams: {} as Record<string, string>,
  threadExists: true,
  preview: vi.fn(),
  openLink: vi.fn(async () => undefined),
  navigate: vi.fn(async (): Promise<void> => undefined),
  openScratchProject: vi.fn(async () => null),
}));

// One connected primary environment that can read pull requests. Its project list and
// discovery flag start empty so a test can deliver links before they arrive.
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useRouter: (() => ({
    navigate: state.navigate,
    state: { matches: [{ params: state.routeParams }] },
  })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => "local" as EnvironmentId,
  usePrimaryEnvironment: (() => ({
    environmentId: "local",
    connection: { phase: "connected" },
    serverConfig: {},
  })) as never,
}));
vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const capabilities = { pullRequests: true, threadPullRequests: true };
  return {
    ...(await original()),
    environmentServerConfigsAtom: Atom.make(
      new Map([["local", { environment: { capabilities } }]]),
    ) as never,
  };
});
vi.mock(import("../../state/shell"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await original()),
    allReachableShellsLiveAtom: Atom.make(false).pipe(Atom.keepAlive),
  };
});
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  readProjects: () => state.projects,
  readThreadShell: (ref: { threadId: string }) =>
    state.threadExists && ref.threadId === "thread"
      ? ({ projectId: "effect", worktreePath: null } as never)
      : null,
  readProject: () => state.projects[0] ?? null,
}));
vi.mock(import("../../hooks/useScratchProject"), async (original) => ({
  ...(await original()),
  useScratchProject: (() => ({
    scratchEnvironmentId: () => "local",
    openScratchProject: state.openScratchProject,
  })) as never,
}));

vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => state.preview,
}));
vi.mock("../../browser/useOpenLink", () => ({ useOpenLink: () => state.openLink }));

import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";
import { allReachableShellsLiveAtom } from "../../state/shell";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../../diffPanelStore";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { DesktopWebLinkCoordinator } from "./DesktopWebLinkCoordinator";

const discoverySettled = allReachableShellsLiveAtom as Atom.Writable<boolean>;
const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("effect");
const project = {
  id: projectId,
  workspaceRoot: "/workspace/effect",
  environmentId,
  repositoryIdentity: {
    provider: "github",
    displayName: "Effect-TS/effect",
    canonicalKey: "github.com/effect-ts/effect",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/Effect-TS/effect.git",
    },
  },
} as never;
const pullRequestUrl = "https://github.com/Effect-TS/effect/pull/9339";
const pullRequestView = {
  to: "/pull-requests",
  search: {
    involvement: "all",
    state: "all",
    repository: "effect-ts/effect",
    number: 9339,
    selectedHost: "github.com",
    selectedProjectId: projectId,
    selectedEnvironmentId: environmentId,
  },
};

function setup() {
  vi.clearAllMocks();
  state.projects = [];
  state.routeParams = {};
  state.threadExists = true;
  state.preview
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ sources: [{ kind: "commit", headRef: sha }] }));
  useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  appAtomRegistry.set(discoverySettled, false);
}

/** Mounts the coordinator behind a desktop bridge that hands over `urls` once the renderer is ready. */
async function mount(...urls: string[]) {
  let deliver: ((url: string) => void) | undefined;
  await using stack = new AsyncDisposableStack();
  stack.use(
    stubGlobal("desktopBridge", {
      getClientSettings: async () => null,
      webLinks: {
        onOpen: (listener: (url: string) => void) => {
          deliver = listener;
          return () => undefined;
        },
        setReady: async (ready: boolean) => {
          if (ready) for (const url of urls.splice(0)) deliver?.(url);
        },
      },
    }),
  );
  stack.use(
    await render(
      <AppAtomRegistryProvider>
        <DesktopWebLinkCoordinator />
      </AppAtomRegistryProvider>,
    ),
  );
  return stack.move();
}

it("holds a launch PR link until project discovery settles, then opens the PR view", async () => {
  setup();
  await using _coordinator = await mount(pullRequestUrl);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.openScratchProject).not.toHaveBeenCalled();

  state.projects = [project];
  const navigated = new Promise<void>((resolve) => {
    state.navigate.mockImplementationOnce(async () => resolve());
  });
  await act(async () => {
    appAtomRegistry.set(discoverySettled, true);
    await navigated;
  });
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith(pullRequestView);
  expect(state.openScratchProject).not.toHaveBeenCalled();
});

const sha = "a".repeat(40);
const commitUrl = `https://github.com/Effect-TS/effect/pull/9339/commits/${sha}`;
const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread"));

it("holds a commit until discovery settles and opens it in the active real thread", async () => {
  setup();
  state.routeParams = { environmentId: "local", threadId: "thread" };
  await using _coordinator = await mount(commitUrl);
  expect(state.preview).not.toHaveBeenCalled();
  expect(state.openScratchProject).not.toHaveBeenCalled();

  state.projects = [project];
  await act(async () => appAtomRegistry.set(discoverySettled, true));
  await vi.waitFor(() => {
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef)).toBe(
      "diff",
    );
  });
  expect(
    selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, threadRef),
  ).toEqual({
    kind: "commit",
    sha,
    baseRef: null,
  });
  expect(state.preview).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { cwd: "/workspace/effect", commitSha: sha, ignoreWhitespace: true },
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.openScratchProject).not.toHaveBeenCalled();
});

it("keeps ordinary PR links in the standalone view while a thread is active", async () => {
  setup();
  state.routeParams = { environmentId: "local", threadId: "thread" };
  state.projects = [project];
  appAtomRegistry.set(discoverySettled, true);
  await using _coordinator = await mount(pullRequestUrl);
  await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledExactlyOnceWith(pullRequestView));
  expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  expect(state.preview).not.toHaveBeenCalled();
});

it.each(["no route", "missing thread", "draft"])(
  "keeps the normal fallback for a commit with %s",
  async (scenario) => {
    setup();
    state.projects = [project];
    if (scenario === "missing thread") {
      state.routeParams = { environmentId: "local", threadId: "thread" };
      state.threadExists = false;
    }
    if (scenario === "draft") state.routeParams = { draftId: "draft" };
    appAtomRegistry.set(discoverySettled, true);
    await using _coordinator = await mount(commitUrl);
    await vi.waitFor(() => expect(state.openScratchProject).toHaveBeenCalledOnce());
    expect(state.preview).not.toHaveBeenCalled();
    expect(useDiffPanelStore.getState().byThreadKey).toEqual({});
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  },
);

it("opens an unavailable active-thread commit externally", async () => {
  setup();
  state.routeParams = { environmentId: "local", threadId: "thread" };
  state.projects = [project];
  state.preview.mockResolvedValueOnce(AsyncResult.success({ sources: [] }));
  appAtomRegistry.set(discoverySettled, true);
  await using _coordinator = await mount(commitUrl);
  await vi.waitFor(() =>
    expect(state.openLink).toHaveBeenCalledExactlyOnceWith(commitUrl, {
      event: { metaKey: true, ctrlKey: false },
      threadRef,
    }),
  );
  expect(useDiffPanelStore.getState().byThreadKey).toEqual({});
  expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  expect(state.openScratchProject).not.toHaveBeenCalled();
});
