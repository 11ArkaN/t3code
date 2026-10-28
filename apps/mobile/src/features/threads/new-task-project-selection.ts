import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { repositoryGroupingKeyOf, type EnvironmentId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";
import type { HomeProjectScope } from "../home/homeThreadList";

type DraftProjectSelectionResolution =
  | { readonly kind: "preserve" }
  | { readonly kind: "select"; readonly project: EnvironmentProject }
  | { readonly kind: "pick" }
  | { readonly kind: "none" };

/**
 * A project's copies, the one a new thread starts in first: the preferred environment's, then
 * the representative. A connected copy wins over a disconnected one.
 */
function orderScopeProjects(
  scope: HomeProjectScope,
  preferredEnvironmentId: EnvironmentId | null,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
): ReadonlyArray<EnvironmentProject> {
  const rank = (project: EnvironmentProject) =>
    (connectedEnvironmentIds.has(project.environmentId) ? 0 : 3) +
    (project.environmentId === preferredEnvironmentId
      ? 0
      : project === scope.representative
        ? 1
        : 2);
  return [...scope.projects].sort((left, right) => rank(left) - rank(right));
}

export function getProjectScopeSelectionTarget(
  scope: HomeProjectScope,
  preferredEnvironmentId: EnvironmentId | null,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
): EnvironmentProject {
  return (
    orderScopeProjects(scope, preferredEnvironmentId, connectedEnvironmentIds)[0] ??
    scope.representative
  );
}

/**
 * One picker row per copy of each project, so a project on two machines shows two rows. Rows
 * name their machine once the projects span more than one.
 */
export function projectPickerRows(
  scopes: ReadonlyArray<HomeProjectScope>,
  preferredEnvironmentId: EnvironmentId | null,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
) {
  const machines = new Set(
    scopes.flatMap((scope) => scope.projects.map((project) => project.environmentId)),
  );
  return {
    rows: scopes.flatMap((scope) =>
      orderScopeProjects(scope, preferredEnvironmentId, connectedEnvironmentIds).map((project) => ({
        scope,
        project,
      })),
    ),
    showsMachines: machines.size > 1,
  };
}

/** A workspace path for a picker row, with the home directory as `~`. */
export function shortWorkspacePath(workspaceRoot: string): string {
  return workspaceRoot.replace(
    /^(?:\/(?:Users\/(?!Shared(?:\/|$))|home\/)[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/,
    "~",
  );
}

export function filterProjectScopes(
  scopes: ReadonlyArray<HomeProjectScope>,
  searchText: string,
): ReadonlyArray<HomeProjectScope> {
  const query = searchText.trim().toLowerCase();
  if (!query) return scopes;
  return scopes.filter(
    (scope) =>
      scope.title.toLowerCase().includes(query) ||
      scope.projects.some(
        (project) =>
          project.title.toLowerCase().includes(query) ||
          project.workspaceRoot.toLowerCase().includes(query),
      ),
  );
}

export function resolveEnvironmentProjectMatch(
  projectsOnTarget: ReadonlyArray<EnvironmentProject>,
  selectedProject: EnvironmentProject | null,
): EnvironmentProject | null {
  const repositoryKey = selectedProject?.repositoryIdentity
    ? repositoryGroupingKeyOf(selectedProject.repositoryIdentity)
    : null;
  // Use || null: placeholder workspaceRoot can be empty, which supplies no useful basename.
  const workspaceBasename = selectedProject?.workspaceRoot.split("/").at(-1) || null;
  // Use weaker signals only when identity is unknown; different known repositories never match by basename or title.
  const isKnownMismatch = (project: EnvironmentProject) => {
    const projectKey = project.repositoryIdentity
      ? repositoryGroupingKeyOf(project.repositoryIdentity)
      : null;
    return repositoryKey !== null && projectKey !== null && projectKey !== repositoryKey;
  };
  return (
    (repositoryKey !== null
      ? projectsOnTarget.find(
          (project) =>
            (project.repositoryIdentity
              ? repositoryGroupingKeyOf(project.repositoryIdentity)
              : null) === repositoryKey,
        )
      : undefined) ??
    (workspaceBasename !== null
      ? projectsOnTarget.find(
          (project) =>
            !isKnownMismatch(project) &&
            project.workspaceRoot.split("/").at(-1) === workspaceBasename,
        )
      : undefined) ??
    (selectedProject !== null
      ? projectsOnTarget.find(
          (project) => !isKnownMismatch(project) && project.title === selectedProject.title,
        )
      : undefined) ??
    projectsOnTarget[0] ??
    null
  );
}

/**
 * The project a draft opens in when its route names none. `projectScopes` are the projects a
 * thread can start in, most recent first. Shared content asks unless only one project fits.
 */
export function resolveDraftProjectSelection(
  selectedProjectKey: string | null,
  projects: ReadonlyArray<EnvironmentProject>,
  projectScopes: ReadonlyArray<HomeProjectScope>,
  draft: {
    readonly incomingShareId: string | undefined;
    readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  },
): DraftProjectSelectionResolution {
  const hasExplicitProjectSelection =
    selectedProjectKey !== null &&
    projects.some(
      (project) => scopedProjectKey(project.environmentId, project.id) === selectedProjectKey,
    );
  if (hasExplicitProjectSelection) {
    return { kind: "preserve" };
  }
  if (draft.incomingShareId !== undefined) {
    const onlyScope = projectScopes.length === 1 ? projectScopes[0] : null;
    return onlyScope ? { kind: "select", project: onlyScope.representative } : { kind: "pick" };
  }
  const recent = projectScopes[0];
  return recent
    ? {
        kind: "select",
        project: getProjectScopeSelectionTarget(recent, null, draft.connectedEnvironmentIds),
      }
    : { kind: "none" };
}

type ProjectRef = { readonly environmentId: string; readonly projectId: string };

export function newTaskDestination(options: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly requestId: string;
  readonly useLastProject: boolean | undefined;
  readonly currentProject: ProjectRef | undefined;
  readonly lastProject: ProjectRef | undefined;
}) {
  const find = (ref: ProjectRef | undefined) =>
    ref &&
    options.projects.find(
      (project) => project.environmentId === ref.environmentId && project.id === ref.projectId,
    );
  const project =
    options.useLastProject === false
      ? undefined
      : (find(options.currentProject) ?? find(options.lastProject));
  return project
    ? {
        draft: {
          requestId: options.requestId,
          environmentId: String(project.environmentId),
          projectId: String(project.id),
        },
      }
    : { draft: { requestId: options.requestId } };
}
