import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { use, useEffect, useEffectEvent } from "react";

import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { useAtomCommand } from "~/state/use-atom-command";

import { BackgroundThreadContext } from "../chat/backgroundThread";
import { COMMIT_DESCRIPTION_BATCH_SIZE } from "./useCommitDescriptions";

/**
 * Asks the server to describe the newest commits while the chat is visible, so the Diff pane's
 * commit menu reads them from the server's cache when it opens.
 */
export function useCommitDescriptionWarmup(input: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  cwd: string | undefined;
  modelKey: string;
  enabled: boolean;
  baseRef: string | null;
  mutationId: string | null;
}) {
  const { environmentId, threadId, cwd, modelKey, baseRef } = input;
  const background = use(BackgroundThreadContext);
  const canGenerate = useAtomValue(
    reviewEnvironment.commitDescriptions.permissionAtom(environmentId),
  );
  const generate = useAtomCommand(reviewEnvironment.commitDescriptions, { reportFailure: false });
  const active =
    input.enabled && canGenerate && !background && modelKey !== "null" && !!threadId && !!cwd;
  const commits = useEnvironmentQuery(
    active && environmentId && cwd
      ? reviewEnvironment.branchCommits({
          environmentId,
          input: { cwd, ...(baseRef ? { baseRef } : {}) },
        })
      : null,
  );
  useWorkspaceMutationRefresh({
    enabled: active,
    mutationId: input.mutationId,
    refresh: commits.refresh,
    resourceKey: JSON.stringify(["branch-commits", environmentId, cwd, baseRef]),
  });
  const shas = commits.data?.commits
    .slice(0, COMMIT_DESCRIPTION_BATCH_SIZE)
    .map((commit) => commit.sha);
  const requestKey =
    active && shas && shas.length > 0
      ? JSON.stringify([environmentId, threadId, cwd, modelKey, shas])
      : null;
  const prepare = useEffectEvent(() => {
    if (!environmentId || !threadId || !cwd || !shas || shas.length === 0) return;
    void generate({ environmentId, input: { cwd, threadId, shas } });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Starts the server's description generation for the visible chat's newest commits.
  useEffect(() => {
    if (requestKey !== null) prepare();
  }, [requestKey]);
}
