import { EnvironmentId, ProjectId, SourceControlProviderKind } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentProject } from "./models.ts";
import { chooseLoadBalancedEnvironment } from "../load-balancing.ts";
import {
  buildProjectGroups,
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  resolveScratchProjectScopeKey,
  signedInRepositoryAccountsFromDiscoveries,
  sortProjectsByGroupOrder,
  type ProjectGroupingSettings,
  type SignedInRepositoryAccount,
} from "./projectGrouping.ts";

const environmentId = EnvironmentId.make("environment");

describe("load balancing shared project machines", () => {
  const now = 100_000;
  const resources = {
    sampledAt: now,
    cpuUtilization: 0.2,
    cpuCount: 8,
    availableMemoryBytes: 8_000,
    totalMemoryBytes: 16_000,
  };

  it("compares three machines using free capacity and preference", () => {
    const candidates = [
      { environmentId: "busy", resources: { ...resources, cpuUtilization: 0.9 }, weight: 1 },
      { environmentId: "idle", resources, weight: 1 },
      { environmentId: "preferred", resources: { ...resources, cpuCount: 4 }, weight: 3 },
    ];
    expect(chooseLoadBalancedEnvironment(candidates, now)).toBe("preferred");
    expect(chooseLoadBalancedEnvironment(candidates.slice(0, 2), now)).toBe("idle");
  });

  it("rejects stale, unknown, excluded and saturated machines", () => {
    expect(
      chooseLoadBalancedEnvironment(
        [
          {
            environmentId: "stale",
            resources: { ...resources, sampledAt: now - 15_001 },
            weight: 1,
          },
          { environmentId: "unknown", resources: null, weight: 1 },
          {
            environmentId: "no-cpu-sample",
            resources: { ...resources, cpuUtilization: null },
            weight: 1,
          },
          { environmentId: "excluded", resources, weight: 0 },
          {
            environmentId: "cpu-full",
            resources: { ...resources, cpuUtilization: 0.95 },
            weight: 1,
          },
          {
            environmentId: "memory-full",
            resources: { ...resources, availableMemoryBytes: 100 },
            weight: 1,
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("uses client receipt time when host clocks differ", () => {
    const candidate = {
      environmentId: "different-clock",
      resources: { ...resources, sampledAt: now + 60_000 },
      receivedAt: now,
      weight: 1,
    };
    expect(chooseLoadBalancedEnvironment([candidate], now)).toBe("different-clock");
    expect(chooseLoadBalancedEnvironment([candidate], now + 15_001)).toBeNull();
  });
});
const repositoryIdentity = {
  canonicalKey: "github.com/t3tools/t3code",
  locator: {
    source: "git-remote" as const,
    remoteName: "upstream",
    remoteUrl: "https://github.com/t3tools/t3code.git",
  },
  provider: SourceControlProviderKind.make("github"),
  owner: "t3tools",
  name: "t3code",
  displayName: "T3 Code",
};

function makeProject(
  id: string,
  workspaceRoot: string,
  overrides: Partial<EnvironmentProject> = {},
): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot,
    repositoryIdentity,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function settings(
  mode: ProjectGroupingSettings["sidebarProjectGroupingMode"],
  overrides: ProjectGroupingSettings["sidebarProjectGroupingOverrides"] = {},
): ProjectGroupingSettings {
  return {
    sidebarProjectGroupingMode: mode,
    sidebarProjectGroupingOverrides: overrides,
  };
}

describe("buildProjectGroups", () => {
  it.each(["repository", "repository_path", "separate"] as const)(
    "keeps scratch project ownership separate by default in %s mode",
    (mode) => {
      const projects = [
        makeProject("scratch-local", "/local/scratch", {
          isScratch: true,
          repositoryIdentity: null,
        }),
        makeProject("scratch-remote", "/remote/scratch", {
          environmentId: EnvironmentId.make("remote"),
          isScratch: true,
          repositoryIdentity: null,
        }),
      ];
      const groups = buildProjectGroups({ projects, settings: settings(mode) });
      expect(groups.map((group) => group.key)).toEqual(projects.map(derivePhysicalProjectKey));
      expect(groups.map((group) => group.memberProjectRefs)).toEqual(
        projects.map((project) => [
          { environmentId: project.environmentId, projectId: project.id },
        ]),
      );
      expect(
        buildProjectGroups({ projects, settings: settings(mode), groupScratchProjects: true }),
      ).toHaveLength(1);
    },
  );

  it.each(["repository", "repository_path", "separate"] as const)(
    "migrates a pre-config %s scratch selection and retains it after the original host is removed",
    (mode) => {
      const local = makeProject("scratch-local", "/local/repo/scratch", {
        repositoryIdentity: { ...repositoryIdentity, rootPath: "/local/repo" },
      });
      const remote = makeProject("scratch-remote", "/remote/scratch", {
        environmentId: EnvironmentId.make("remote"),
        repositoryIdentity: null,
        isScratch: true,
      });
      const groupingSettings = settings(mode);
      const selectedBeforeConfig = deriveLogicalProjectKeyFromSettings(local, groupingSettings);
      const loaded = [{ ...local, isScratch: true as const }, remote];
      const migrated = resolveScratchProjectScopeKey(
        selectedBeforeConfig,
        loaded,
        groupingSettings,
      );
      const scratchKey = buildProjectGroups({
        projects: loaded,
        settings: groupingSettings,
        groupScratchProjects: true,
      })[0]!.key;
      expect(migrated).toBe(scratchKey);
      expect(resolveScratchProjectScopeKey(migrated, [remote], groupingSettings)).toBe(scratchKey);
      expect(
        buildProjectGroups({
          projects: [remote],
          settings: groupingSettings,
          groupScratchProjects: true,
        })[0]?.memberProjectRefs,
      ).toEqual([{ environmentId: remote.environmentId, projectId: remote.id }]);
    },
  );

  it("retains a repository filter that still belongs to an ordinary project", () => {
    const scratch = makeProject("scratch", "/scratch", { isScratch: true });
    const ordinary = makeProject("ordinary", "/ordinary");
    const key = deriveLogicalProjectKeyFromSettings(ordinary, settings("repository"));
    expect(resolveScratchProjectScopeKey(key, [scratch, ordinary])).toBe(key);
  });

  it.each(["repository", "repository_path", "separate"] as const)(
    "coalesces scratch homes in %s mode without merging ordinary same-title projects",
    (mode) => {
      const remoteEnvironmentId = EnvironmentId.make("remote");
      const projects = [
        makeProject("scratch-local", "/local/scratch", {
          title: "No project",
          isScratch: true,
          repositoryIdentity: null,
        }),
        makeProject("scratch-remote", "/remote/scratch", {
          title: "No project",
          environmentId: remoteEnvironmentId,
          isScratch: true,
        }),
        makeProject("scratch-duplicate", "/remote/scratch/", {
          title: "No project",
          environmentId: remoteEnvironmentId,
          isScratch: true,
          repositoryIdentity: null,
          updatedAt: "2026-07-02T00:00:00.000Z",
        }),
        makeProject("ordinary", "/ordinary", { title: "No project" }),
        makeProject("reserved-collision", "/other", {
          title: "No project",
          repositoryIdentity: { ...repositoryIdentity, canonicalKey: "\0no-project" },
        }),
      ];
      const groups = buildProjectGroups({
        projects,
        groupScratchProjects: true,
        settings: settings(mode, { [derivePhysicalProjectKey(projects[0]!)]: "separate" }),
        preferredEnvironmentId: remoteEnvironmentId,
      });
      expect(groups).toHaveLength(3);
      const scratch = groups.find((group) => group.representative.isScratch)!;
      expect(scratch.label).toBe("No project");
      expect(scratch.representative.id).toBe(projects[2]?.id);
      expect(scratch.members).toHaveLength(2);
      expect(scratch.memberProjectRefs).toEqual(
        projects.slice(0, 3).map((project) => ({
          environmentId: project.environmentId,
          projectId: project.id,
        })),
      );
      expect(resolveScratchProjectScopeKey(derivePhysicalProjectKey(projects[1]!), projects)).toBe(
        scratch.key,
      );
      expect(resolveScratchProjectScopeKey(derivePhysicalProjectKey(projects[3]!), projects)).toBe(
        derivePhysicalProjectKey(projects[3]!),
      );
      expect(groups.filter((group) => !group.representative.isScratch)).toHaveLength(2);
    },
  );

  it("preserves every physical clone as a selectable member in repository modes", () => {
    const projects = [
      makeProject("t3code", "/work/t3code"),
      makeProject("t3code-2", "/work/t3code-2"),
      makeProject("t3code-3", "/work/t3code-3"),
    ];

    for (const mode of ["repository", "repository_path"] as const) {
      const groups = buildProjectGroups({ projects, settings: settings(mode) });
      expect(groups).toHaveLength(1);
      expect(groups[0]?.members.map((member) => member.project.id)).toEqual([
        "t3code",
        "t3code-2",
        "t3code-3",
      ]);
      expect(groups[0]?.memberProjectRefs).toHaveLength(3);
    }
  });

  it("keeps a fork apart from its upstream checkout and labels it by its own remote", () => {
    const fork = makeProject("fork", "/work/t3code-fork", {
      repositoryIdentity: {
        ...repositoryIdentity,
        origin: {
          canonicalKey: "github.com/julius/t3code-fork",
          displayName: "julius/t3code-fork",
        },
      },
    });
    const forkWorktree = makeProject("fork-2", "/work/t3code-fork-2", {
      repositoryIdentity: fork.repositoryIdentity,
    });
    const projects = [makeProject("t3code", "/work/t3code"), fork, forkWorktree];

    const groups = buildProjectGroups({ projects, settings: settings("repository") });
    expect(groups.map((group) => group.key)).toEqual([
      "github.com/t3tools/t3code",
      "github.com/julius/t3code-fork",
    ]);
    expect(groups[1]?.members.map((member) => member.project.id)).toEqual(["fork", "fork-2"]);
    expect(groups[1]?.label).toBe("julius/t3code-fork");
  });

  it("applies a physical-project override without dropping its siblings", () => {
    const first = makeProject("t3code", "/work/t3code");
    const second = makeProject("t3code-2", "/work/t3code-2");
    const third = makeProject("t3code-3", "/work/t3code-3");
    const groups = buildProjectGroups({
      projects: [first, second, third],
      settings: settings("repository", {
        [derivePhysicalProjectKey(second)]: "separate",
      }),
    });

    expect(groups).toHaveLength(2);
    expect(groups.flatMap((group) => group.members.map((member) => member.project.id))).toEqual([
      "t3code",
      "t3code-3",
      "t3code-2",
    ]);
  });

  it("dedupes stale registrations at one physical path using the freshest project", () => {
    const stale = makeProject("stale", "/work/t3code", {
      repositoryIdentity: null,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const fresh = makeProject("fresh", "/work/t3code/", {
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    const groups = buildProjectGroups({
      projects: [stale, fresh],
      settings: settings("repository"),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(1);
    expect(groups[0]?.representative.id).toBe("fresh");
    expect(groups[0]?.memberProjectRefs).toHaveLength(2);
  });

  it("uses the freshest winner's repository identity when stale duplicates disagree", () => {
    const staleIdentity = {
      ...repositoryIdentity,
      canonicalKey: "github.com/t3tools/old-repository",
      name: "old-repository",
      displayName: "Old Repository",
    };
    const stale = makeProject("stale", "/work/t3code", {
      repositoryIdentity: staleIdentity,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const fresh = makeProject("fresh", "/work/t3code/", {
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    const sibling = makeProject("sibling", "/work/t3code-2");

    const groups = buildProjectGroups({
      projects: [stale, fresh, sibling],
      settings: settings("repository"),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.project.id)).toEqual(["fresh", "sibling"]);
  });

  it("uses the freshest identity-bearing duplicate when the winner lacks identity", () => {
    const staleIdentity = {
      ...repositoryIdentity,
      canonicalKey: "github.com/t3tools/old-repository",
      name: "old-repository",
      displayName: "Old Repository",
    };
    const staleIdentified = makeProject("stale-identified", "/work/t3code", {
      repositoryIdentity: staleIdentity,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const freshIdentified = makeProject("fresh-identified", "/work/t3code/", {
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    const winner = makeProject("winner", "/work/t3code", {
      repositoryIdentity: null,
      updatedAt: "2026-07-03T00:00:00.000Z",
    });
    const sibling = makeProject("sibling", "/work/t3code-2");

    const groups = buildProjectGroups({
      projects: [staleIdentified, freshIdentified, winner, sibling],
      settings: settings("repository"),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.project.id)).toEqual(["winner", "sibling"]);
  });
});

function ownedRepository(owner: string, name: string, host = "github.com") {
  return {
    canonicalKey: `${host}/${owner}/${name}`,
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: `https://${host}/${owner}/${name}.git`,
    },
    provider: SourceControlProviderKind.make("github"),
    owner,
    name,
    displayName: `${owner}/${name}`,
  };
}

function signedIn(
  account: string,
  host = "github.com",
  provider = "github",
): SignedInRepositoryAccount {
  return { provider, account, host };
}

describe("linked repository labels", () => {
  const remote = EnvironmentId.make("remote");

  function linked(identity: EnvironmentProject["repositoryIdentity"], title: string) {
    return buildProjectGroups({
      projects: [
        makeProject("local", "/local/repo", { title, repositoryIdentity: identity }),
        makeProject("remote", "/remote/repo", {
          title,
          environmentId: remote,
          repositoryIdentity: identity,
        }),
      ],
      settings: settings("repository"),
      signedInRepositoryAccounts: [signedIn("EtanHey")],
    });
  }

  it("keeps a single checkout titled with the repository name", () => {
    const identity = ownedRepository("EtanHey", "orchestrator");
    const groups = buildProjectGroups({
      projects: [
        makeProject("local", "/local/repo", {
          title: "orchestrator",
          repositoryIdentity: identity,
        }),
      ],
      settings: settings("repository"),
      signedInRepositoryAccounts: [signedIn("EtanHey")],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("orchestrator");
    expect(groups[0]?.key).toBe(identity.canonicalKey);
  });

  it("drops the owner prefix when it matches the signed-in account", () => {
    const identity = ownedRepository("EtanHey", "orchestrator");
    const groups = linked(identity, "orchestrator");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(identity.canonicalKey);
    expect(groups[0]?.label).toBe("orchestrator");
    expect(groups[0]?.memberProjectRefs).toHaveLength(2);
  });

  it("keeps the owner when the signed-in account is unknown", () => {
    const identity = ownedRepository("EtanHey", "orchestrator");
    const groups = buildProjectGroups({
      projects: [
        makeProject("local", "/local/repo", {
          title: "orchestrator",
          repositoryIdentity: identity,
        }),
        makeProject("remote", "/remote/repo", {
          title: "orchestrator",
          environmentId: remote,
          repositoryIdentity: identity,
        }),
      ],
      settings: settings("repository"),
    });
    expect(groups[0]?.label).toBe("EtanHey/orchestrator");
    expect(groups[0]?.key).toBe(identity.canonicalKey);
  });

  it("keeps another account's owner and matches logins without case", () => {
    expect(linked(ownedRepository("pingdotgg", "t3code"), "t3code")[0]?.label).toBe(
      "pingdotgg/t3code",
    );
    expect(
      buildProjectGroups({
        projects: [
          makeProject("local", "/local/repo", {
            title: "orchestrator",
            repositoryIdentity: ownedRepository("EtanHey", "orchestrator"),
          }),
          makeProject("remote", "/remote/repo", {
            title: "orchestrator",
            environmentId: remote,
            repositoryIdentity: ownedRepository("EtanHey", "orchestrator"),
          }),
        ],
        settings: settings("repository"),
        signedInRepositoryAccounts: [signedIn("etanhey")],
      })[0]?.label,
    ).toBe("orchestrator");
  });

  it("keeps an explicit custom title, including one that repeats the qualified name", () => {
    expect(linked(ownedRepository("EtanHey", "orchestrator"), "Nightly")[0]?.label).toBe("Nightly");
    expect(
      linked(ownedRepository("EtanHey", "orchestrator"), "EtanHey/orchestrator")[0]?.label,
    ).toBe("EtanHey/orchestrator");
  });

  it("keeps the owner when the host or provider does not match the signed-in account", () => {
    const identity = ownedRepository("EtanHey", "orchestrator");
    const projects = [
      makeProject("local", "/local/repo", { title: "orchestrator", repositoryIdentity: identity }),
      makeProject("remote", "/remote/repo", {
        title: "orchestrator",
        environmentId: remote,
        repositoryIdentity: identity,
      }),
    ];
    expect(
      buildProjectGroups({
        projects,
        settings: settings("repository"),
        signedInRepositoryAccounts: [signedIn("EtanHey", "ghe.example.com")],
      })[0]?.label,
    ).toBe("EtanHey/orchestrator");
    expect(
      buildProjectGroups({
        projects,
        settings: settings("repository"),
        signedInRepositoryAccounts: [signedIn("EtanHey", "gitlab.com", "gitlab")],
      })[0]?.label,
    ).toBe("EtanHey/orchestrator");
    const { provider: _provider, ...withoutProvider } = identity;
    expect(
      buildProjectGroups({
        projects: projects.map((project) => ({ ...project, repositoryIdentity: withoutProvider })),
        settings: settings("repository"),
        signedInRepositoryAccounts: [signedIn("EtanHey")],
      })[0]?.label,
    ).toBe("EtanHey/orchestrator");
  });

  it("labels an own fork by its repository name and keeps the upstream owner", () => {
    const upstream = ownedRepository("pingdotgg", "t3code");
    const fork = {
      ...upstream,
      origin: {
        canonicalKey: "github.com/EtanHey/t3code",
        displayName: "EtanHey/t3code",
      },
    };
    const groups = buildProjectGroups({
      projects: [
        makeProject("upstream", "/local/t3code", {
          title: "t3code",
          repositoryIdentity: upstream,
        }),
        makeProject("upstream-remote", "/remote/t3code", {
          title: "t3code",
          environmentId: remote,
          repositoryIdentity: upstream,
        }),
        makeProject("fork", "/local/fork", { title: "t3code", repositoryIdentity: fork }),
        makeProject("fork-remote", "/remote/fork", {
          title: "t3code",
          environmentId: remote,
          repositoryIdentity: fork,
        }),
      ],
      settings: settings("repository"),
      signedInRepositoryAccounts: [signedIn("EtanHey")],
    });
    expect(groups.map((group) => [group.key, group.label])).toEqual([
      ["github.com/pingdotgg/t3code", "pingdotgg/t3code"],
      ["github.com/EtanHey/t3code", "t3code"],
    ]);
  });

  it("keeps the owner when the short name matches another project label", () => {
    const identity = ownedRepository("EtanHey", "orchestrator");
    const groups = buildProjectGroups({
      projects: [
        makeProject("local", "/local/repo", {
          title: "orchestrator",
          repositoryIdentity: identity,
        }),
        makeProject("remote", "/remote/repo", {
          title: "orchestrator",
          environmentId: remote,
          repositoryIdentity: identity,
        }),
        makeProject("notes", "/local/notes", {
          title: "orchestrator",
          repositoryIdentity: null,
        }),
      ],
      settings: settings("repository"),
      signedInRepositoryAccounts: [signedIn("EtanHey")],
    });
    expect(groups.map((group) => group.label)).toEqual(["EtanHey/orchestrator", "orchestrator"]);
    expect(groups.map((group) => group.key)).toEqual([
      identity.canonicalKey,
      derivePhysicalProjectKey(makeProject("notes", "/local/notes")),
    ]);
  });

  it("keeps both owners when two signed-in accounts would share a short name", () => {
    const groups = buildProjectGroups({
      projects: [
        makeProject("own", "/own", {
          title: "app",
          repositoryIdentity: ownedRepository("EtanHey", "app"),
        }),
        makeProject("own-remote", "/own-remote", {
          title: "app",
          environmentId: remote,
          repositoryIdentity: ownedRepository("EtanHey", "app"),
        }),
        makeProject("work", "/work", {
          title: "app",
          repositoryIdentity: ownedRepository("work", "app"),
        }),
        makeProject("work-remote", "/work-remote", {
          title: "app",
          environmentId: remote,
          repositoryIdentity: ownedRepository("work", "app"),
        }),
      ],
      settings: settings("repository"),
      signedInRepositoryAccounts: [signedIn("EtanHey"), signedIn("work")],
    });
    expect(groups.map((group) => group.label)).toEqual(["EtanHey/app", "work/app"]);
  });

  it("reads authenticated provider logins and ignores unknown or signed-out providers", () => {
    expect(
      signedInRepositoryAccountsFromDiscoveries([
        null,
        {
          sourceControlProviders: [
            {
              kind: SourceControlProviderKind.make("github"),
              auth: {
                status: "authenticated",
                account: Option.some("EtanHey"),
                host: Option.some("github.com"),
                accounts: [
                  { host: "github.com", account: "EtanHey", authenticated: true },
                  { host: "github.com", account: "work", authenticated: true },
                  { host: "github.com", account: "expired", authenticated: false },
                ],
              },
            },
            {
              kind: SourceControlProviderKind.make("gitlab"),
              auth: {
                status: "unauthenticated",
                account: Option.some("EtanHey"),
                host: Option.some("gitlab.com"),
                accounts: [{ host: "gitlab.com", account: "EtanHey", authenticated: true }],
              },
            },
            {
              kind: SourceControlProviderKind.make("forgejo"),
              auth: {
                status: "unknown",
                account: Option.none(),
                host: Option.none(),
              },
            },
          ],
        },
      ]),
    ).toEqual([
      { provider: "github", account: "EtanHey", host: "github.com" },
      { provider: "github", account: "work", host: "github.com" },
    ]);
    expect(signedInRepositoryAccountsFromDiscoveries([undefined])).toEqual([]);
  });
});

describe("sortProjectsByGroupOrder", () => {
  const remote = EnvironmentId.make("remote");
  const ref = (projectId: string, env = environmentId) => ({
    environmentId: env,
    projectId: ProjectId.make(projectId),
  });
  const project = (id: string, env: string = environmentId) => ({ id, environmentId: env });

  it("tells the same project id on two environments apart", () => {
    const sorted = sortProjectsByGroupOrder(
      [project("shared"), project("shared", remote)],
      [{ memberProjectRefs: [ref("shared", remote)] }, { memberProjectRefs: [ref("shared")] }],
    );
    expect(sorted.map((entry) => entry.environmentId)).toEqual([remote, environmentId]);
  });
});
