import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { reviewEnvironment } from "~/state/review";
import { useAtomCommand } from "~/state/use-atom-command";

export const COMMIT_DESCRIPTION_BATCH_SIZE = 10;

interface Loaded {
  readonly scope: string | null;
  readonly descriptions: ReadonlyMap<string, string>;
  /** Shas asked for since the menu opened, so a failed batch waits for the next open. */
  readonly requested: ReadonlySet<string>;
}

const empty = (scope: string | null): Loaded => ({
  scope,
  descriptions: new Map(),
  requested: new Set(),
});

/** Descriptions for the commit menu, asked for a batch at a time as the user scrolls. */
export function useCommitDescriptions({
  environmentId,
  threadId,
  cwd,
  modelKey,
  shas,
}: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  cwd: string | undefined;
  modelKey: string;
  shas: ReadonlyArray<string>;
}) {
  const canGenerate = useAtomValue(
    reviewEnvironment.commitDescriptions.permissionAtom(environmentId),
  );
  const generate = useAtomCommand(reviewEnvironment.commitDescriptions, { reportFailure: false });
  const scope =
    canGenerate && environmentId && threadId && cwd && modelKey !== "null"
      ? JSON.stringify([environmentId, threadId, cwd, modelKey])
      : null;
  const [stored, setStored] = useState(() => empty(scope));
  const loaded = stored.scope === scope ? stored : empty(scope);

  const load = (start: number, retry: boolean) => {
    if (scope === null || !environmentId || !threadId || !cwd) return;
    const skip = retry ? loaded.descriptions : loaded.requested;
    const batch = shas
      .slice(start, start + COMMIT_DESCRIPTION_BATCH_SIZE)
      .filter((sha) => !skip.has(sha));
    // A no-op load must not re-render: the boundary row's observer would fire again and loop.
    if (batch.length === 0 && !retry) return;
    setStored((latest) => {
      const base = latest.scope === scope ? latest : empty(scope);
      const kept = retry ? base.descriptions.keys() : base.requested;
      return { ...base, requested: new Set([...kept, ...batch]) };
    });
    if (batch.length === 0) return;
    void generate({ environmentId, input: { cwd, threadId, shas: batch } }).then((result) => {
      if (result._tag !== "Success") return;
      setStored((latest) =>
        latest.scope === scope
          ? {
              ...latest,
              descriptions: new Map([
                ...latest.descriptions,
                ...result.value.descriptions.map(
                  ({ sha, description }) => [sha, description] as const,
                ),
              ]),
            }
          : latest,
      );
    });
  };

  /**
   * Asks for the next batch once the last row of the current one scrolls into view. The first
   * row asks for the first batch, for a list that arrives after the menu opened.
   */
  const observeRow = (index: number) => {
    const start =
      index === 0
        ? 0
        : (index + 1) % COMMIT_DESCRIPTION_BATCH_SIZE === 0 && index + 1 < shas.length
          ? index + 1
          : null;
    return start === null
      ? undefined
      : (element: HTMLElement | null) => {
          if (!element) return;
          const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            load(start, false);
          });
          observer.observe(element);
          return () => observer.disconnect();
        };
  };

  return {
    descriptions: loaded.descriptions,
    /** Call when the menu opens; it also retries batches that failed while it was last open. */
    loadFirst: () => load(0, true),
    observeRow,
  };
}
