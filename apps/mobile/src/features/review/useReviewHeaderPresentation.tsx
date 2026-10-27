import { useEnvironmentQuery } from "../../state/query";
import { useSelectedThreadGitActions } from "../../state/use-selected-thread-git-actions";
import { useSelectedThreadGitState } from "../../state/use-selected-thread-git-state";
import { useThreadSelection } from "../../state/use-thread-selection";
import { vcsEnvironment } from "../../state/vcs";
import { useThreadGitToolbarActions } from "../threads/ThreadGitControls";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReviewSectionItem } from "./reviewModel";
import type { AppBarAction, AppBarMenuItem } from "../../components/ui/AppBar.types";
import type { AppSymbolName } from "../../components/ui/AppSymbol";

interface ReviewHeaderPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly gitActions: ReadonlyArray<AppBarAction>;
  readonly menuIcon: AppSymbolName;
  readonly refreshAction?: AppBarMenuItem;
}

export function useReviewHeaderPresentation(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly subtitle: string;
  readonly androidSubtitle: string;
  readonly selectedThreadCwd: string | null;
  readonly selectedSection: ReviewSectionItem | null;
  readonly onRefresh: () => Promise<void>;
}): ReviewHeaderPresentation {
  const { selectedThread } = useThreadSelection();
  const gitState = useSelectedThreadGitState();
  const gitActions = useSelectedThreadGitActions();
  const gitStatusQuery = useEnvironmentQuery(
    selectedThread !== null && props.selectedThreadCwd !== null
      ? vcsEnvironment.status({
          environmentId: selectedThread.environmentId,
          input: { cwd: props.selectedThreadCwd },
        })
      : null,
  );
  // Selection-based git hooks apply only to reviews of the selected thread.
  const gitActionsAvailable =
    selectedThread !== null && String(selectedThread.id) === String(props.threadId);
  const toolbarActions = useThreadGitToolbarActions({
    environmentId: props.environmentId,
    threadId: props.threadId,
    gitStatus: gitStatusQuery.data,
    gitOperationLabel: gitState.gitOperationLabel,
    onPull: gitActions.onPullSelectedThreadBranch,
    onRunAction: gitActions.onRunSelectedThreadGitAction,
  });
  return {
    title: props.title,
    subtitle: props.subtitle,
    menuIcon: "ellipsis",
    gitActions: gitActionsAvailable ? toolbarActions : [],
  };
}
