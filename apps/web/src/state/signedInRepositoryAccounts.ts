import { signedInRepositoryAccountsFromDiscoveries } from "@t3tools/client-runtime/state/project-grouping";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentSummaries } from "./presentation";
import { sourceControlEnvironment } from "./sourceControl";

const signedInRepositoryAccountsAtom = Atom.make((get) =>
  signedInRepositoryAccountsFromDiscoveries(
    get(environmentSummaries.connectedEnvironmentIdsAtom).map((environmentId) => {
      const result = get(sourceControlEnvironment.discovery({ environmentId, input: {} }));
      return AsyncResult.isSuccess(result) ? result.value : null;
    }),
  ),
).pipe(Atom.withLabel("web:signed-in-repository-accounts"));

export function useSignedInRepositoryAccounts() {
  return useAtomValue(signedInRepositoryAccountsAtom);
}
