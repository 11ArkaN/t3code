import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { HomeProjectScope } from "../home/homeThreadList";
import {
  getProjectScopeSelectionTarget,
  newTaskDestination,
  projectPickerRows,
  resolveDraftProjectSelection,
  resolveEnvironmentProjectMatch,
  shortWorkspacePath,
} from "./new-task-project-selection";

function makeProject(
  id: string,
  environmentId = "environment",
  options: {
    readonly title?: string;
    readonly workspaceRoot?: string;
    readonly repositoryKey?: string;
  } = {},
): EnvironmentProject {
  return {
    environmentId: EnvironmentId.make(environmentId),
    id: ProjectId.make(id),
    title: options.title ?? id,
    workspaceRoot: options.workspaceRoot ?? `/work/${id}`,
    repositoryIdentity: options.repositoryKey
      ? {
          canonicalKey: options.repositoryKey,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: `https://${options.repositoryKey}.git`,
          },
        }
      : null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function makeScope(projects: ReadonlyArray<EnvironmentProject>): HomeProjectScope {
  return {
    key: "github.com/t3tools/t3code",
    title: "T3 Code",
    representative: projects[0]!,
    projects,
    projectRefs: projects.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
    })),
  };
}

describe("getProjectScopeSelectionTarget", () => {
  it("prefers a connected copy of a project that spans environments", () => {
    const mac = makeProject("t3code", "mac");
    const server = makeProject("t3code", "server");
    const target = (connected: ReadonlyArray<string>, preferred: string | null = null) =>
      getProjectScopeSelectionTarget(
        makeScope([mac, server]),
        preferred === null ? null : EnvironmentId.make(preferred),
        new Set(connected.map((id) => EnvironmentId.make(id))),
      );
    expect(target(["server"])).toBe(server);
    expect(target(["server"], "mac")).toBe(server);
    expect(target(["mac", "server"], "server")).toBe(server);
    expect(target(["mac", "server"])).toBe(mac);
    // With nothing connected, the usual order still applies.
    expect(target([], "server")).toBe(server);
    expect(target([])).toBe(mac);
  });
});

describe("projectPickerRows", () => {
  it("lists each copy of a project, a connected one first, and names machines once they differ", () => {
    const mac = makeProject("t3code", "mac");
    const server = makeProject("t3code", "server");
    const react = makeProject("react", "mac");
    const picker = projectPickerRows(
      [makeScope([mac, server]), makeScope([react])],
      null,
      new Set([EnvironmentId.make("server")]),
    );
    expect(picker.rows.map((row) => row.project)).toEqual([server, mac, react]);
    expect(picker.showsMachines).toBe(true);

    const oneMachine = projectPickerRows([makeScope([mac]), makeScope([react])], null, new Set());
    expect(oneMachine.showsMachines).toBe(false);
  });
});

describe("shortWorkspacePath", () => {
  it.each([
    ["/Users/theo/code/t3code", "~/code/t3code"],
    ["/home/theo/t3code", "~/t3code"],
    ["/home/theo", "~"],
    ["/root/app", "~/app"],
    ["C:\\Users\\theo\\code", "~\\code"],
    ["/Users/Shared/repo", "/Users/Shared/repo"],
    ["/var/folders/12/workspace/react", "/var/folders/12/workspace/react"],
  ])("shows %s as %s", (path, short) => {
    expect(shortWorkspacePath(path)).toBe(short);
  });
});

describe("resolveEnvironmentProjectMatch", () => {
  it("follows the same repository onto the target machine", () => {
    const selected = makeProject("t3code", "mac", { repositoryKey: "github.com/t3tools/t3code" });
    const target = [
      makeProject("other", "server", { repositoryKey: "github.com/t3tools/other" }),
      makeProject("t3code-clone", "server", { repositoryKey: "github.com/t3tools/t3code" }),
    ];
    expect(resolveEnvironmentProjectMatch(target, selected)).toBe(target[1]);
  });

  it("falls back to workspace basename, then title, for unindexed projects", () => {
    const selected = makeProject("t3code", "mac", { workspaceRoot: "/Users/me/t3code" });
    const byBasename = [
      makeProject("other", "server"),
      makeProject("srv", "server", { workspaceRoot: "/home/me/t3code" }),
    ];
    expect(resolveEnvironmentProjectMatch(byBasename, selected)).toBe(byBasename[1]);

    const byTitle = [
      makeProject("other", "server"),
      makeProject("srv", "server", { title: "t3code" }),
    ];
    expect(resolveEnvironmentProjectMatch(byTitle, selected)).toBe(byTitle[1]);
  });

  it("does not treat a known different repository as a basename or title match", () => {
    const selected = makeProject("t3code", "mac", {
      repositoryKey: "github.com/t3tools/t3code",
      workspaceRoot: "/Users/me/t3code",
    });
    const fork = makeProject("fork", "server", {
      repositoryKey: "github.com/someone/t3code",
      title: "t3code",
      workspaceRoot: "/home/me/t3code",
    });
    const unindexed = makeProject("unindexed", "server", { workspaceRoot: "/srv/t3code" });
    expect(resolveEnvironmentProjectMatch([fork, unindexed], selected)).toBe(unindexed);
    expect(resolveEnvironmentProjectMatch([fork], selected)).toBe(fork);
  });
});

describe("resolveDraftProjectSelection", () => {
  const projects = [makeProject("t3code"), makeProject("t3code-2")];
  const draft = { incomingShareId: undefined, connectedEnvironmentIds: new Set<EnvironmentId>() };

  it("starts a draft without a project in the most recent project, on a connected machine", () => {
    const mac = makeProject("t3code", "mac");
    const server = makeProject("t3code", "server");
    const scopes = [makeScope([mac, server]), makeScope([makeProject("older")])];
    expect(
      resolveDraftProjectSelection(null, [mac, server], scopes, {
        ...draft,
        connectedEnvironmentIds: new Set([EnvironmentId.make("server")]),
      }),
    ).toEqual({ kind: "select", project: server });
    expect(resolveDraftProjectSelection(null, [], [], draft)).toEqual({ kind: "none" });
  });

  it("selects the only logical project for shared content", () => {
    expect(
      resolveDraftProjectSelection(null, projects, [makeScope(projects)], {
        ...draft,
        incomingShareId: "share",
      }),
    ).toEqual({ kind: "select", project: projects[0] });
  });

  it("keeps the project the draft already chose", () => {
    expect(
      resolveDraftProjectSelection("environment:t3code-2", projects, [makeScope(projects)], draft),
    ).toEqual({ kind: "preserve" });
  });

  it("asks where shared content goes when more than one project could take it", () => {
    const scopes = [makeScope([projects[0]!]), makeScope([projects[1]!])];
    expect(
      resolveDraftProjectSelection(null, projects, scopes, { ...draft, incomingShareId: "share" }),
    ).toEqual({ kind: "pick" });
  });
});

describe("newTaskDestination", () => {
  // A draft that names no project opens in the most recent one (see resolveDraftProjectSelection).
  const projectless = { draft: { requestId: "request" } };

  function destination(options: {
    readonly useLastProject: boolean | undefined;
    readonly projects: ReadonlyArray<EnvironmentProject>;
    readonly current?: EnvironmentProject;
    readonly last?: { readonly environmentId: string; readonly projectId: string };
  }) {
    return newTaskDestination({
      projects: options.projects,
      requestId: "request",
      useLastProject: options.useLastProject,
      currentProject: options.current && {
        environmentId: options.current.environmentId,
        projectId: options.current.id,
      },
      lastProject: options.last,
    });
  }

  it("starts in the current thread's project ahead of the remembered one", () => {
    const projects = [makeProject("remembered"), makeProject("current", "other-environment")];
    expect(
      destination({
        useLastProject: true,
        projects,
        current: projects[1],
        last: { environmentId: "environment", projectId: "remembered" },
      }),
    ).toEqual({
      draft: { requestId: "request", environmentId: "other-environment", projectId: "current" },
    });
  });

  it("treats an unset preference as on", () => {
    const projects = [makeProject("first"), makeProject("current")];
    expect(destination({ useLastProject: undefined, projects, current: projects[1] })).toEqual({
      draft: { requestId: "request", environmentId: "environment", projectId: "current" },
    });
  });

  it("starts in the remembered project of its own environment when there is no current one", () => {
    const projects = [makeProject("chosen"), makeProject("chosen", "other-environment")];
    expect(
      destination({
        useLastProject: true,
        projects,
        last: { environmentId: "other-environment", projectId: "chosen" },
      }),
    ).toEqual({
      draft: { requestId: "request", environmentId: "other-environment", projectId: "chosen" },
    });
  });

  it("ignores a remembered project id from another environment", () => {
    expect(
      destination({
        useLastProject: true,
        projects: [makeProject("chosen")],
        last: { environmentId: "removed-environment", projectId: "chosen" },
      }),
    ).toEqual(projectless);
  });

  it("names no project rather than the first one when nothing matches", () => {
    expect(
      destination({
        useLastProject: true,
        projects: [makeProject("first"), makeProject("second")],
        current: makeProject("removed"),
      }),
    ).toEqual(projectless);
  });

  it("ignores the current and last project when the preference is off", () => {
    const only = makeProject("only");
    expect(
      destination({
        useLastProject: false,
        projects: [only],
        current: only,
        last: { environmentId: "environment", projectId: "only" },
      }),
    ).toEqual(projectless);
  });
});
