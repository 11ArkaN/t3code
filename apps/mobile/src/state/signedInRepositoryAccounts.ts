import { signedInRepositoryAccountsFromDiscoveries } from "@t3tools/client-runtime/state/project-grouping";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";

import { sourceControlEnvironment } from "./sourceControl";
import { workspaceConnections } from "./workspace";

const signedInRepositoryAccountsAtom = Atom.make((get) =>
  signedInRepositoryAccountsFromDiscoveries(
    get(workspaceConnections.environmentsAtom).flatMap((environment) => {
      if (!environment.isEnabled || environment.connectionState !== "connected") return [];
      const result = get(
        sourceControlEnvironment.discovery({
          environmentId: environment.environmentId,
          input: {},
        }),
      );
      return [AsyncResult.isSuccess(result) ? result.value : null];
    }),
  ),
).pipe(Atom.withLabel("mobile:signed-in-repository-accounts"));

export function useSignedInRepositoryAccounts() {
  return useAtomValue(signedInRepositoryAccountsAtom);
}
