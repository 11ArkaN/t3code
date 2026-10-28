import { scopedProjectKey, scopeProjectRef } from "../environment/scoped.ts";
import {
  repositoryGroupingDisplayNameOf,
  repositoryGroupingKeyOf,
  type EnvironmentId,
  type RepositoryIdentity,
  type ScopedProjectRef,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";

import type { EnvironmentProject } from "./models.ts";
import { normalizeProjectPathForComparison } from "./projects.ts";

const SCRATCH_PROJECT_SCOPE_KEY = "\0no-project";
const NO_SIGNED_IN_REPOSITORY_ACCOUNTS: readonly SignedInRepositoryAccount[] = [];

export interface SignedInRepositoryAccount {
  readonly provider: string;
  readonly account: string;
  readonly host?: string;
}

export function signedInRepositoryAccountsFromDiscoveries(
  discoveries: ReadonlyArray<
    | {
        readonly sourceControlProviders: ReadonlyArray<{
          readonly kind: string;
          readonly auth: {
            readonly status: string;
            readonly account: Option.Option<string>;
            readonly host: Option.Option<string>;
            readonly accounts?: ReadonlyArray<{
              readonly host: string;
              readonly account: string;
              readonly authenticated: boolean;
            }>;
          };
        }>;
      }
    | null
    | undefined
  >,
): readonly SignedInRepositoryAccount[] {
  const accounts: SignedInRepositoryAccount[] = [];
  const seen = new Set<string>();
  const add = (provider: string, account: string, host: string | undefined) => {
    const trimmedProvider = provider.trim();
    const trimmedAccount = account.trim();
    const trimmedHost = host?.trim();
    if (!trimmedProvider || !trimmedAccount) return;
    const key = `${trimmedProvider.toLowerCase()}\0${(trimmedHost ?? "").toLowerCase()}\0${trimmedAccount.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    accounts.push(
      trimmedHost
        ? { provider: trimmedProvider, account: trimmedAccount, host: trimmedHost }
        : { provider: trimmedProvider, account: trimmedAccount },
    );
  };

  for (const discovery of discoveries) {
    if (!discovery) continue;
    for (const provider of discovery.sourceControlProviders) {
      if (provider.auth.status !== "authenticated") continue;
      const account = Option.getOrUndefined(provider.auth.account);
      if (account) add(provider.kind, account, Option.getOrUndefined(provider.auth.host));
      for (const entry of provider.auth.accounts ?? []) {
        if (!entry.authenticated) continue;
        add(provider.kind, entry.account, entry.host);
      }
    }
  }

  return accounts.length === 0 ? NO_SIGNED_IN_REPOSITORY_ACCOUNTS : accounts;
}

function tokenKey(value: string): string {
  return value.trim().toLowerCase();
}

function repositoryLabelHost(identity: RepositoryIdentity): string | undefined {
  const host = (identity.origin?.canonicalKey ?? identity.canonicalKey).split("/")[0]?.trim();
  return host || undefined;
}

function signedInAccountOwnsLabel(
  owner: string,
  provider: string,
  host: string | undefined,
  accounts: readonly SignedInRepositoryAccount[],
): boolean {
  const ownerKey = tokenKey(owner);
  const providerKey = tokenKey(provider);
  const hostKey = host ? tokenKey(host) : undefined;
  if (!ownerKey || !providerKey) return false;
  return accounts.some((account) => {
    if (tokenKey(account.account) !== ownerKey || tokenKey(account.provider) !== providerKey) {
      return false;
    }
    return !hostKey || !account.host || tokenKey(account.host) === hostKey;
  });
}

function omitOwnOwnerPrefix(
  qualified: string,
  members: ReadonlyArray<Pick<EnvironmentProject, "repositoryIdentity">>,
  accounts: readonly SignedInRepositoryAccount[] | undefined,
): string | null {
  if (!accounts || accounts.length === 0) return null;
  const slash = qualified.indexOf("/");
  if (slash <= 0 || slash >= qualified.length - 1) return null;
  const owner = qualified.slice(0, slash);
  let sawProducer = false;
  for (const member of members) {
    const identity = member.repositoryIdentity;
    if (!identity || repositoryGroupingDisplayNameOf(identity) !== qualified) continue;
    sawProducer = true;
    if (
      !identity.provider ||
      !signedInAccountOwnsLabel(owner, identity.provider, repositoryLabelHost(identity), accounts)
    ) {
      return null;
    }
  }
  return sawProducer ? qualified.slice(slash + 1) : null;
}

export interface ProjectGroupingSettings {
  readonly sidebarProjectGroupingMode: SidebarProjectGroupingMode;
  readonly sidebarProjectGroupingOverrides: Record<string, SidebarProjectGroupingMode>;
}

export type ProjectGroupingMode = SidebarProjectGroupingMode;

export function selectProjectGroupingSettings(settings: ClientSettings): ProjectGroupingSettings {
  return {
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  };
}

function uniqueNonEmptyValues(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function deriveRepositoryRelativeProjectPath(
  project: Pick<EnvironmentProject, "workspaceRoot" | "repositoryIdentity">,
): string | null {
  const rootPath = project.repositoryIdentity?.rootPath?.trim();
  if (!rootPath) {
    return null;
  }

  const normalizedProjectPath = normalizeProjectPathForComparison(project.workspaceRoot);
  const normalizedRootPath = normalizeProjectPathForComparison(rootPath);
  if (normalizedProjectPath.length === 0 || normalizedRootPath.length === 0) {
    return null;
  }

  if (normalizedProjectPath === normalizedRootPath) {
    return "";
  }

  const separator = normalizedRootPath.includes("\\") ? "\\" : "/";
  const rootPrefix = `${normalizedRootPath}${separator}`;
  if (!normalizedProjectPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedProjectPath.slice(rootPrefix.length).replaceAll("\\", "/");
}

export function derivePhysicalProjectKeyFromPath(environmentId: string, cwd: string): string {
  return `${environmentId}:${normalizeProjectPathForComparison(cwd)}`;
}

export function derivePhysicalProjectKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKeyFromPath(project.environmentId, project.workspaceRoot);
}

function deriveProjectGroupingOverrideKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKey(project);
}

export function getProjectOrderKey(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
): string {
  return derivePhysicalProjectKey(project);
}

function resolveProjectGroupingMode(
  project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">,
  settings: ProjectGroupingSettings,
): SidebarProjectGroupingMode {
  return (
    settings.sidebarProjectGroupingOverrides?.[deriveProjectGroupingOverrideKey(project)] ??
    settings.sidebarProjectGroupingMode
  );
}

function deriveRepositoryScopedKey(
  project: Pick<EnvironmentProject, "workspaceRoot" | "repositoryIdentity">,
  groupingMode: SidebarProjectGroupingMode,
): string | null {
  const canonicalKey = project.repositoryIdentity
    ? repositoryGroupingKeyOf(project.repositoryIdentity)
    : null;
  // A NUL reserves the scratch key namespace outside valid repository identities.
  if (!canonicalKey || canonicalKey.includes("\0")) {
    return null;
  }

  if (groupingMode === "repository") {
    return canonicalKey;
  }

  const relativeProjectPath = deriveRepositoryRelativeProjectPath(project);
  if (relativeProjectPath === null) {
    return canonicalKey;
  }

  return relativeProjectPath.length === 0
    ? canonicalKey
    : `${canonicalKey}::${relativeProjectPath}`;
}

function deriveLogicalProjectKey(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch"
  >,
  options?: {
    readonly groupingMode?: SidebarProjectGroupingMode;
    readonly groupScratchProjects?: boolean;
  },
): string {
  if (options?.groupScratchProjects && project.isScratch) return SCRATCH_PROJECT_SCOPE_KEY;
  const groupingMode = options?.groupingMode ?? "repository";
  if (groupingMode === "separate") {
    return derivePhysicalProjectKey(project);
  }

  return (
    deriveRepositoryScopedKey(project, groupingMode) ??
    derivePhysicalProjectKey(project) ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function deriveLogicalProjectKeyFromSettings(
  project: Pick<
    EnvironmentProject,
    "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch"
  >,
  settings: ProjectGroupingSettings,
  options?: { readonly groupScratchProjects?: boolean },
): string {
  return deriveLogicalProjectKey(project, {
    groupingMode: resolveProjectGroupingMode(project, settings),
    groupScratchProjects: options?.groupScratchProjects ?? false,
  });
}

export function resolveScratchProjectScopeKey(
  key: string | null,
  projects: ReadonlyArray<
    Pick<
      EnvironmentProject,
      "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity" | "isScratch"
    >
  >,
  settings: ProjectGroupingSettings = {
    sidebarProjectGroupingMode: "repository",
    sidebarProjectGroupingOverrides: {},
  },
): string | null {
  if (key === null || key === SCRATCH_PROJECT_SCOPE_KEY) return key;
  if (
    projects.some(
      (project) =>
        deriveLogicalProjectKeyFromSettings(project, settings, { groupScratchProjects: true }) ===
        key,
    )
  ) {
    return key;
  }
  return projects.some((project) => {
    if (!project.isScratch) return false;
    const mode = resolveProjectGroupingMode(project, settings);
    return (
      derivePhysicalProjectKey(project) === key ||
      (mode !== "separate" && deriveRepositoryScopedKey(project, mode) === key)
    );
  })
    ? SCRATCH_PROJECT_SCOPE_KEY
    : key;
}

export function deriveProjectGroupLabel(input: {
  readonly representative: Pick<EnvironmentProject, "title" | "repositoryIdentity">;
  readonly members: ReadonlyArray<Pick<EnvironmentProject, "title" | "repositoryIdentity">>;
  readonly signedInRepositoryAccounts?: readonly SignedInRepositoryAccount[];
  readonly avoidLabels?: readonly string[];
}): string {
  const sharedTitles = uniqueNonEmptyValues(input.members.map((member) => member.title));
  const sharedDisplayNames = uniqueNonEmptyValues(
    input.members.map((member) =>
      member.repositoryIdentity ? repositoryGroupingDisplayNameOf(member.repositoryIdentity) : null,
    ),
  );
  const sharedRepositoryNames = uniqueNonEmptyValues(
    input.members.map((member) => member.repositoryIdentity?.name),
  );
  const sharedTitle = sharedTitles[0];
  if (
    sharedTitles.length === 1 &&
    sharedTitle !== undefined &&
    !sharedDisplayNames.includes(sharedTitle) &&
    !sharedRepositoryNames.includes(sharedTitle)
  ) {
    return sharedTitle;
  }
  if (sharedDisplayNames.length === 1) {
    const qualified = sharedDisplayNames[0]!;
    if (sharedTitles.length === 1 && sharedTitle === qualified) return qualified;
    const shortened = omitOwnOwnerPrefix(
      qualified,
      input.members,
      input.signedInRepositoryAccounts,
    );
    if (shortened && !input.avoidLabels?.includes(shortened)) return shortened;
    return qualified;
  }

  if (sharedRepositoryNames.length === 1) {
    return sharedRepositoryNames[0]!;
  }

  return input.representative.title;
}

export interface ProjectGroupMember<TProject extends EnvironmentProject = EnvironmentProject> {
  readonly physicalProjectKey: string;
  readonly project: TProject;
}

export interface ProjectGroup<TProject extends EnvironmentProject = EnvironmentProject> {
  readonly key: string;
  readonly label: string;
  readonly representative: TProject;
  readonly members: ReadonlyArray<ProjectGroupMember<TProject>>;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

function projectFreshnessTime(project: EnvironmentProject): number {
  const updatedAtTime = Date.parse(project.updatedAt);
  if (Number.isFinite(updatedAtTime)) {
    return updatedAtTime;
  }
  const createdAtTime = Date.parse(project.createdAt);
  return Number.isFinite(createdAtTime) ? createdAtTime : 0;
}

function shouldReplacePhysicalProjectWinner<TProject extends EnvironmentProject>(
  existing: TProject,
  candidate: TProject,
): boolean {
  const freshnessDelta = projectFreshnessTime(candidate) - projectFreshnessTime(existing);
  return freshnessDelta > 0 || (freshnessDelta === 0 && candidate.id > existing.id);
}

function selectProjectIdentitySource<TProject extends EnvironmentProject>(
  projects: ReadonlyArray<TProject>,
  winner: TProject,
): TProject {
  if (winner.repositoryIdentity !== null) {
    return winner;
  }

  let freshestIdentifiedProject: TProject | null = null;
  for (const project of projects) {
    if (project.repositoryIdentity === null) {
      continue;
    }
    if (
      freshestIdentifiedProject === null ||
      shouldReplacePhysicalProjectWinner(freshestIdentifiedProject, project)
    ) {
      freshestIdentifiedProject = project;
    }
  }
  return freshestIdentifiedProject ?? winner;
}

export function buildProjectGroups<TProject extends EnvironmentProject>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly settings: ProjectGroupingSettings;
  readonly preferredEnvironmentId?: EnvironmentId | null;
  readonly groupScratchProjects?: boolean;
  readonly signedInRepositoryAccounts?: readonly SignedInRepositoryAccount[];
}): ReadonlyArray<ProjectGroup<TProject>> {
  const projectsByPhysicalKey = new Map<string, TProject[]>();
  for (const project of input.projects) {
    const physicalProjectKey = derivePhysicalProjectKey(project);
    const existing = projectsByPhysicalKey.get(physicalProjectKey);
    if (existing) {
      existing.push(project);
    } else {
      projectsByPhysicalKey.set(physicalProjectKey, [project]);
    }
  }

  const logicalKeyByPhysicalKey = new Map<string, string>();
  const groupedMembers = new Map<string, ProjectGroupMember<TProject>[]>();
  for (const [physicalProjectKey, physicalProjects] of projectsByPhysicalKey) {
    const winner = physicalProjects.reduce((current, candidate) =>
      shouldReplacePhysicalProjectWinner(current, candidate) ? candidate : current,
    );
    const identitySource = selectProjectIdentitySource(physicalProjects, winner);
    const logicalKey = deriveLogicalProjectKey(identitySource, {
      groupingMode: resolveProjectGroupingMode(winner, input.settings),
      groupScratchProjects: input.groupScratchProjects ?? false,
    });
    logicalKeyByPhysicalKey.set(physicalProjectKey, logicalKey);
    const member = { physicalProjectKey, project: winner };
    const existing = groupedMembers.get(logicalKey);
    if (existing) {
      existing.push(member);
    } else {
      groupedMembers.set(logicalKey, [member]);
    }
  }

  const projectRefsByLogicalKey = new Map<string, ScopedProjectRef[]>();
  const seenProjectRefs = new Set<string>();
  for (const project of input.projects) {
    const physicalProjectKey = derivePhysicalProjectKey(project);
    const logicalKey =
      logicalKeyByPhysicalKey.get(physicalProjectKey) ??
      deriveLogicalProjectKeyFromSettings(project, input.settings, {
        groupScratchProjects: input.groupScratchProjects ?? false,
      });
    const projectRefKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
    if (seenProjectRefs.has(projectRefKey)) continue;
    seenProjectRefs.add(projectRefKey);
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    const existing = projectRefsByLogicalKey.get(logicalKey);
    if (existing) {
      existing.push(projectRef);
    } else {
      projectRefsByLogicalKey.set(logicalKey, [projectRef]);
    }
  }

  const preferredEnvironmentId = input.preferredEnvironmentId ?? null;
  const labeled = Array.from(groupedMembers, ([key, members]) => {
    const representative =
      (preferredEnvironmentId
        ? members.find((member) => member.project.environmentId === preferredEnvironmentId)?.project
        : null) ?? members[0]!.project;
    const memberProjects = members.map((member) => member.project);
    const qualifiedLabel =
      input.groupScratchProjects && representative.isScratch
        ? "No project"
        : members.length > 1
          ? deriveProjectGroupLabel({ representative, members: memberProjects })
          : representative.title;
    const label =
      input.groupScratchProjects && representative.isScratch
        ? "No project"
        : members.length > 1
          ? deriveProjectGroupLabel({
              representative,
              members: memberProjects,
              ...(input.signedInRepositoryAccounts
                ? { signedInRepositoryAccounts: input.signedInRepositoryAccounts }
                : {}),
            })
          : representative.title;
    return {
      key,
      label,
      ownerQualified: label === qualifiedLabel ? null : qualifiedLabel,
      representative,
      members,
      memberProjectRefs: projectRefsByLogicalKey.get(key) ?? [],
    };
  });
  const labelCounts = new Map<string, number>();
  for (const group of labeled) {
    labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
  }
  return labeled.map(({ ownerQualified, ...group }) =>
    ownerQualified !== null && (labelCounts.get(group.label) ?? 0) > 1
      ? { ...group, label: ownerQualified }
      : group,
  );
}

export function sortProjectsByGroupOrder<
  TProject extends { readonly id: string; readonly environmentId: string },
>(
  projects: ReadonlyArray<TProject>,
  groups: ReadonlyArray<{ readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef> }>,
): TProject[] {
  const rankByProject = new Map<string, number>();
  groups.forEach((group, rank) => {
    for (const ref of group.memberProjectRefs) {
      const key = `${ref.environmentId}\0${ref.projectId}`;
      if (!rankByProject.has(key)) rankByProject.set(key, rank);
    }
  });
  const rankOf = (project: TProject) =>
    rankByProject.get(`${project.environmentId}\0${project.id}`) ?? groups.length;
  return [...projects].sort((left, right) => rankOf(left) - rankOf(right));
}
