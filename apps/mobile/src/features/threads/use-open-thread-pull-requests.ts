import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { StackActions, useNavigation } from "@react-navigation/native";

import * as Dialog from "../../components/ui/Dialog";
import { useNavigateToPullRequest } from "../../native/useOpenPullRequest";
import {
  resolveThreadPrBadgeAction,
  type ThreadPrPresentation,
} from "../../state/thread-pr-presentation";

/**
 * Called once per thread list so virtualized rows share one stable handler. A sheet passes
 * `replace` so the pull request takes its place instead of opening underneath it.
 */
export function useOpenThreadPullRequests(options?: { readonly replace?: boolean }) {
  const navigation = useNavigation();
  const replace = options?.replace;
  const navigateToPullRequest = useNavigateToPullRequest({ replace });
  return (thread: EnvironmentThreadShell, pr: ThreadPrPresentation) => {
    if (resolveThreadPrBadgeAction(pr).kind === "list") {
      const params = {
        environmentId: String(thread.environmentId),
        threadId: String(thread.id),
      };
      if (replace) navigation.dispatch(StackActions.replace("ThreadPullRequests", params));
      else navigation.navigate("ThreadPullRequests", params);
      return;
    }
    void navigateToPullRequest(pr.url, {
      environmentId: String(thread.environmentId),
      projectId: String(thread.projectId),
    }).then((opened) => {
      if (!opened)
        Dialog.alert(
          `Unable to open ${pr.changeRequest.shortLabel}`,
          `The ${pr.changeRequest.singular} could not be opened.`,
        );
    });
  };
}
