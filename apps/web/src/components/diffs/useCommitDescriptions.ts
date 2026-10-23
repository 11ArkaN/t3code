import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { reviewEnvironment } from "~/state/review";
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

interface DescriptionState {
  readonly scope: string | null;
  readonly wanted: number;
  readonly descriptions: ReadonlyMap<string, string>;
  readonly failed: boolean;
}

const initialState = (scope: string | null): DescriptionState => ({
  scope,
  wanted: BATCH_SIZE,
  descriptions: new Map(),
  failed: false,
});

export function useCommitDescriptions({
  environmentId,
  threadId,
  cwd,
  modelKey,
  shas,
  open,
}: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  cwd: string | undefined;
  modelKey: string;
  shas: ReadonlyArray<string>;
  open: boolean;
}) {
  const canGenerate = useAtomValue(
    reviewEnvironment.commitDescriptions.permissionAtom(environmentId),
  );
  const generate = useAtomCommand(reviewEnvironment.commitDescriptions, { reportFailure: false });
  const scope =
    canGenerate && environmentId && threadId && cwd
      ? JSON.stringify([environmentId, threadId, cwd, modelKey])
      : null;
  const [stored, setState] = useState(() => initialState(scope));
  const state = stored.scope === scope ? stored : initialState(scope);
  const requested = useRef({ scope, shas: new Set<string>() });
  const shasKey = shas.join(",");

  useEffect(() => {
    if (!open || scope === null || state.failed || !environmentId || !threadId || !cwd) return;
    if (requested.current.scope !== scope) requested.current = { scope, shas: new Set() };
    const batch = nextCommitDescriptionBatch(
      shasKey ? shasKey.split(",") : [],
      state.wanted,
      requested.current.shas,
    );
    if (batch.length === 0) return;
    for (const sha of batch) requested.current.shas.add(sha);
    void generate({ environmentId, input: { cwd, threadId, shas: batch } }).then((result) =>
      setState((stored) => {
        const current = stored.scope === scope ? stored : initialState(scope);
        if (requested.current.scope !== scope) return stored;
        return result._tag === "Success"
          ? {
              ...current,
              descriptions: new Map([
                ...current.descriptions,
                ...result.value.descriptions.map(
                  ({ sha, description }) => [sha, description] as const,
                ),
              ]),
            }
          : { ...current, failed: true };
      }),
    );
  }, [cwd, environmentId, generate, open, scope, shasKey, state.failed, state.wanted, threadId]);

  const observeLast = (element: HTMLElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setState((stored) => {
        const current = stored.scope === scope ? stored : initialState(scope);
        return { ...current, wanted: current.wanted + BATCH_SIZE };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  };

  return { descriptions: state.descriptions, lastIndex: state.wanted - 1, observeLast };
}
