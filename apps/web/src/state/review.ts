import { Atom } from "effect/reactivity";

import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime/state/review";

import { connectionAtomRuntime } from "../connection/runtime";

export const reviewEnvironment = createReviewEnvironmentAtoms(connectionAtomRuntime);

interface CommitDescriptionState {
  readonly owners: Set<object>;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly pending: ReadonlyArray<string> | null;
  readonly failed: boolean;
}

export const emptyCommitDescriptions = (owners = new Set<object>()): CommitDescriptionState => ({
  owners,
  descriptions: new Map(),
  pending: null,
  failed: false,
});

export const commitDescriptionsAtom = Atom.family((scope: string | null) =>
  Atom.make(emptyCommitDescriptions()).pipe(
    Atom.setIdleTTL(5 * 60_000),
    Atom.withLabel(`web-review:commit-descriptions:${scope}`),
  ),
);

export const activeCommitDescriptionScopeAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
