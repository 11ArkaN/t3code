import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { use } from "react";

import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";

import { useCommitDescriptions } from "./useCommitDescriptions";
import { BackgroundThreadContext } from "../chat/backgroundThread";

export function useCommitDescriptionWarmup(input: {
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  cwd: string | undefined;
  modelKey: string;
  enabled: boolean;
  baseRef: string | null;
  mutationId: string | null;
}) {
  const background = use(BackgroundThreadContext);
  const canGenerate = useAtomValue(
    reviewEnvironment.commitDescriptions.permissionAtom(input.environmentId),
  );
  const enabled = input.enabled && canGenerate && !!input.threadId && !!input.cwd;
  const commits = useEnvironmentQuery(
    enabled && !background && input.environmentId && input.cwd
      ? reviewEnvironment.branchCommits({
          environmentId: input.environmentId,
          input: {
            cwd: input.cwd,
            ...(input.baseRef ? { baseRef: input.baseRef } : {}),
          },
        })
      : null,
  );
  useWorkspaceMutationRefresh({
    enabled: enabled && !background,
    mutationId: input.mutationId,
    refresh: commits.refresh,
    resourceKey: JSON.stringify([
      "commit-descriptions",
      input.environmentId,
      input.threadId,
      input.cwd,
      input.baseRef,
    ]),
  });
  useCommitDescriptions({
    ...input,
    shas: commits.data?.commits.map((commit) => commit.sha) ?? [],
    enabled,
    visible: !background,
    open: false,
    prepare: !background,
  });
}
