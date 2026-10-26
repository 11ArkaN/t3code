import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import { Atom } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentShell, environmentShellSummaryAtom } from "./shell";
import { isEnvironmentOffline, projectWorkspaceState } from "./workspaceModel";
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

let lastOfflineEnvironmentIds: ReadonlySet<EnvironmentId> = new Set();

export const offlineEnvironmentIdsAtom = Atom.make((get) => {
  const networkStatus = get(environmentCatalog.networkStatusValueAtom);
  const ids = get(workspaceConnections.environmentsAtom).flatMap((environment) =>
    isEnvironmentOffline({
      networkStatus,
      connectionState: environment.connectionState,
    })
      ? [environment.environmentId]
      : [],
  );
  if (
    ids.length !== lastOfflineEnvironmentIds.size ||
    ids.some((id) => !lastOfflineEnvironmentIds.has(id))
  ) {
    lastOfflineEnvironmentIds = new Set(ids);
  }
  return lastOfflineEnvironmentIds;
}).pipe(Atom.withLabel("mobile:offline-environment-ids"));

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
