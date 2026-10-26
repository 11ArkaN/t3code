import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { ModelSelection, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  activeCommitDescriptionScopeAtom,
  commitDescriptionsAtom,
  emptyCommitDescriptions,
  reviewEnvironment,
} from "~/state/review";
import { useAtomCommand } from "~/state/use-atom-command";

const BATCH_SIZE = 10;

export function nextCommitDescriptionBatch(
  shas: ReadonlyArray<string>,
  wanted: number,
  requested: ReadonlySet<string>,
): string[] {
  return shas
    .slice(0, wanted)
    .filter((sha) => !requested.has(sha))
    .slice(0, BATCH_SIZE);
}

const decodeModelSelection = Schema.decodeSync(Schema.fromJsonString(ModelSelection));

export function useCommitMenuSnapshot<A>(data: A, open: boolean, scope: string | null): A {
  const [snapshot, setSnapshot] = useState({ data, open, scope });
  if (
    snapshot.scope !== scope ||
    snapshot.open !== open ||
    (snapshot.data === null && data !== null)
  ) {
    setSnapshot({ data, open, scope });
    return data;
  }
  return open ? snapshot.data : data;
}

export function useCommitDescriptions({
  environmentId,
  threadId,
  cwd,
  modelKey,
  shas,
  enabled,
  visible,
  open,
  prepare = false,
}: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  cwd: string | undefined;
  modelKey: string;
  shas: ReadonlyArray<string>;
  enabled: boolean;
  visible: boolean;
  open: boolean;
  prepare?: boolean;
}) {
  const registry = useContext(RegistryContext);
  const permission = reviewEnvironment.commitDescriptions.permissionAtom(environmentId);
  const canGenerate = useAtomValue(permission);
  const generate = useAtomCommand(reviewEnvironment.commitDescriptions, { reportFailure: false });
  const modelSelection = modelKey === "null" ? null : decodeModelSelection(modelKey);
  const scope =
    enabled && canGenerate && environmentId && threadId && cwd && modelSelection
      ? JSON.stringify([environmentId, threadId, cwd, modelKey])
      : null;
  const atom = commitDescriptionsAtom(scope);
  const state = useAtomValue(atom);
  const [window, setWindow] = useState({ scope, wanted: BATCH_SIZE });
  const wanted = window.scope === scope ? window.wanted : BATCH_SIZE;
  const previous = useRef(atom);
  const shasKey = shas.join(",");

  // oxlint-disable-next-line t3code/react-effect-budget -- Register mounted consumers of the shared cache.
  useLayoutEffect(() => {
    if (scope === null) return;
    const owners = registry.get(atom).owners;
    const owner = {};
    owners.add(owner);
    return () => {
      owners.delete(owner);
    };
  }, [atom, registry, scope]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Invalidate pending cache claims when the active scope changes.
  useLayoutEffect(() => {
    const old = prepare
      ? commitDescriptionsAtom(registry.get(activeCommitDescriptionScopeAtom))
      : previous.current;
    previous.current = atom;
    if (prepare) registry.set(activeCommitDescriptionScopeAtom, scope);
    if (old === atom) return;
    setWindow({ scope, wanted: BATCH_SIZE });
    const stored = registry.get(old);
    if (!prepare && stored.owners.size > 0) return;
    registry.set(
      old,
      scope === null ? emptyCommitDescriptions(stored.owners) : { ...stored, pending: null },
    );
  }, [atom, prepare, registry, scope]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Start provider requests for the visible commit window.
  useEffect(() => {
    if (
      !visible ||
      scope === null ||
      !environmentId ||
      !threadId ||
      !cwd ||
      !modelSelection ||
      state.failed ||
      state.pending
    )
      return;
    const current = registry.get(atom);
    if (current.failed || current.pending || !registry.get(permission)) return;
    const commitShas = shasKey ? shasKey.split(",") : [];
    const batch = nextCommitDescriptionBatch(
      commitShas,
      open ? wanted : BATCH_SIZE,
      new Set(current.descriptions.keys()),
    );
    if (batch.length === 0) return;
    registry.set(atom, { ...current, pending: batch });
    const unsubscribe = registry.subscribe(permission, (allowed) => {
      if (!allowed) registry.set(atom, emptyCommitDescriptions(registry.get(atom).owners));
    });
    void generate({ environmentId, input: { cwd, threadId, shas: batch } }).then((result) => {
      unsubscribe();
      const stored = registry.get(atom);
      if (stored.pending !== batch) return;
      if (!registry.get(permission)) {
        registry.set(atom, emptyCommitDescriptions(stored.owners));
        return;
      }
      if (
        result._tag !== "Success" ||
        !modelSelectionsEqual(modelSelection, result.value.modelSelection)
      ) {
        registry.set(atom, { ...stored, pending: null, failed: true });
        return;
      }
      const descriptions = new Map(stored.descriptions);
      for (const { sha, description } of result.value.descriptions) {
        if (batch.includes(sha)) descriptions.set(sha, description);
      }
      registry.set(atom, {
        ...stored,
        descriptions: new Map([...descriptions].filter(([sha]) => commitShas.includes(sha))),
        pending: null,
        failed: false,
      });
    });
  }, [
    atom,
    cwd,
    environmentId,
    generate,
    modelSelection,
    open,
    permission,
    registry,
    scope,
    shasKey,
    state.failed,
    state.pending,
    threadId,
    visible,
    wanted,
  ]);

  const retry = () => {
    const stored = registry.get(atom);
    if (stored.failed) registry.set(atom, { ...stored, failed: false });
  };

  const observeLast = (element: HTMLElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setWindow((stored) => ({
        scope,
        wanted: (stored.scope === scope ? stored.wanted : BATCH_SIZE) + BATCH_SIZE,
      }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  };

  const descriptions = useCommitMenuSnapshot(state.descriptions, open, scope);
  return { descriptions, lastIndex: wanted - 1, observeLast, retry };
}
