import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { environmentShell, environmentShellSummaryAtom } from "./shell";
import { projectLiveEnvironmentIds, projectWorkspaceState } from "./workspaceModel";
import { environmentCatalog } from "../connection/catalog";
import { environmentPresentations } from "./presentation";
import { createWorkspaceConnectionAtoms } from "./workspace-connection-atoms";

export const workspaceConnections = createWorkspaceConnectionAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  networkStatusValueAtom: environmentCatalog.networkStatusValueAtom,
  presentationAtom: environmentPresentations.presentationAtom,
});

// A disconnected environment's retries also leave its shell synchronizing.
const hasSyncingConnectedEnvironmentAtom = Atom.make((get) =>
  get(workspaceConnections.environmentsAtom).some(
    (environment) =>
      environment.isEnabled &&
      environment.connectionState === "connected" &&
      get(environmentShell.stateValueAtom(environment.environmentId)).status === "synchronizing",
  ),
).pipe(Atom.withLabel("mobile:has-syncing-connected-environment"));

export const liveEnvironmentIdsAtom = Atom.make((get) => {
  const next = projectLiveEnvironmentIds({
    networkStatus: get(environmentCatalog.networkStatusValueAtom),
    environments: get(workspaceConnections.environmentsAtom),
  });
  const previous = Option.getOrNull(get.self<ReadonlySet<EnvironmentId>>());
  return previous !== null && previous.size === next.length && next.every((id) => previous.has(id))
    ? previous
    : new Set(next);
}).pipe(Atom.withLabel("mobile:live-environment-ids"));

export function useWorkspaceEnvironments() {
  return useAtomValue(workspaceConnections.environmentsAtom);
}

export function useWorkspaceConnectionState() {
  return useAtomValue(workspaceConnections.stateAtom);
}

export function useConnectionsReady() {
  return useAtomValue(workspaceConnections.isReadyAtom);
}

export function useWorkspaceState() {
  const isReady = useConnectionsReady();
  const networkStatus = useAtomValue(environmentCatalog.networkStatusValueAtom);
  const projectedEnvironments = useWorkspaceEnvironments();
  const shellSummary = useAtomValue(environmentShellSummaryAtom);
  const hasSyncingConnectedEnvironment = useAtomValue(hasSyncingConnectedEnvironmentAtom);
  const state = useMemo(
    () =>
      projectWorkspaceState({
        isReady,
        networkStatus,
        environments: projectedEnvironments,
        shellSummary,
        hasSyncingConnectedEnvironment,
      }),
    [isReady, networkStatus, projectedEnvironments, shellSummary, hasSyncingConnectedEnvironment],
  );

  return {
    environments: projectedEnvironments,
    state,
  };
}
