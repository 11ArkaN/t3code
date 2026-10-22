import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  openInApp: true,
  threadExists: true,
  repositoryKey: "github.com/pingdotgg/t3code",
  projectEnvironmentId: "local",
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { pullRequestLinksOpenInApp: boolean }) => unknown) =>
    select({ pullRequestLinksOpenInApp: state.openInApp }),
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "local" }));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => new Map([["local", { environment: { capabilities: { pullRequests: true } } }]]),
  },
}));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {}, serverEnvironment: {} }));
vi.mock("../state/entities", () => ({
  readThreadShell: (ref: { environmentId: string; threadId: string }) =>
    state.threadExists && ref.environmentId === "local" && ref.threadId === "thread"
      ? { environmentId: "local", projectId: "project" }
      : null,
  readProject: (ref: { environmentId: string; projectId: string }) =>
    ref.environmentId === state.projectEnvironmentId && ref.projectId === "project"
      ? project()
      : null,
  readProjects: () => [project()],
}));

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useOpenChangeRequestLink } from "./openPullRequestLink";

const ref = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));
const sha = "5235a682169a69d18261c8bf4f1017dfb01b28fe";
const commitUrl = `https://github.com/pingdotgg/t3code/pull/19941/commits/${sha}`;

function project() {
  return {
    id: ProjectId.make("project"),
    environmentId: EnvironmentId.make(state.projectEnvironmentId),
    repositoryIdentity: {
      provider: "github",
      canonicalKey: state.repositoryKey,
      displayName: state.repositoryKey.split("/").slice(1).join("/"),
      locator: { remoteUrl: `https://${state.repositoryKey}.git` },
    },
  };
}

function click(modifiers = {}) {
  return {
    metaKey: false,
    ctrlKey: false,
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    ...modifiers,
  };
}

beforeEach(() => {
  state.openInApp = true;
  state.threadExists = true;
  state.repositoryKey = "github.com/pingdotgg/t3code";
  state.projectEnvironmentId = "local";
  state.navigate.mockReset();
  useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("commit link opening", () => {
  it("opens a port-bearing GitHub Enterprise URL for its normalized repository key", () => {
    state.repositoryKey = "github.acme.test/team/repo";
    expect(
      useOpenChangeRequestLink(ref)(
        click(),
        `https://github.acme.test:8443/team/repo/commit/${sha}`,
      ),
    ).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("diff");
    expect(selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, ref)).toEqual({
      kind: "commit",
      sha,
      baseRef: null,
    });
  });

  it.each([commitUrl, `https://github.com/pingdotgg/t3code/commit/${sha}`])(
    "opens the Diff panel with the commit and saved base: %s",
    (url) => {
      useDiffPanelStore.getState().selectBranchBaseRef(ref, "origin/main");
      const event = click();
      expect(useOpenChangeRequestLink(ref)(event, url)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("diff");
      expect(selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, ref)).toEqual(
        {
          kind: "commit",
          sha,
          baseRef: "origin/main",
        },
      );
    },
  );

  it.each([{ metaKey: true }, { ctrlKey: true }, { button: 1 }])(
    "leaves modified clicks to the original URL: %s",
    (modifiers) => {
      const event = click(modifiers);
      expect(useOpenChangeRequestLink(ref)(event, commitUrl)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(useRightPanelStore.getState().byThreadKey).toEqual({});
      expect(useDiffPanelStore.getState().byThreadKey).toEqual({});
    },
  );

  it.each([
    "preference off",
    "missing thread",
    "wrong repository",
    "wrong host",
    "wrong environment",
  ])("falls back without changing either panel for %s", (scenario) => {
    if (scenario === "preference off") state.openInApp = false;
    if (scenario === "missing thread") state.threadExists = false;
    if (scenario === "wrong repository") state.repositoryKey = "github.com/pingdotgg/other";
    if (scenario === "wrong host") state.repositoryKey = "github.internal/pingdotgg/t3code";
    if (scenario === "wrong environment") state.projectEnvironmentId = "remote";
    const event = click();
    expect(useOpenChangeRequestLink(ref)(event, commitUrl)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(useDiffPanelStore.getState().byThreadKey).toEqual({});
  });

  it("does not use a synthetic PR panel or a matching project without a real thread", () => {
    const event = click();
    expect(useOpenChangeRequestLink(undefined, ref)(event, commitUrl)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(useDiffPanelStore.getState().byThreadKey).toEqual({});
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("opens a matching real thread supplied by the desktop link handler", () => {
    expect(useOpenChangeRequestLink()(click(), commitUrl, ref)).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe("diff");
    expect(selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, ref)).toEqual({
      kind: "commit",
      sha,
      baseRef: null,
    });
  });

  it("still opens ordinary PR links in the PR panel", () => {
    expect(
      useOpenChangeRequestLink(ref)(click(), "https://github.com/pingdotgg/t3code/pull/19941"),
    ).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, ref)).toBe(
      "pull-request",
    );
    expect(useDiffPanelStore.getState().byThreadKey).toEqual({});
  });
});
