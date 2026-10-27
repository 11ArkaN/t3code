import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  canSnooze,
  effectiveSnoozed,
  resolveSnoozePresets,
} from "@t3tools/client-runtime/state/thread-settled";
import { AuthOrchestrationOperateScope, type VcsStatusResult } from "@t3tools/contracts";
import { useState } from "react";
import type { HeaderBarButtonItemWithMenu } from "react-native-screens";

import * as Dialog from "../../components/ui/Dialog";
import { useNowMinuteMs } from "../../lib/clock";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { uuidv4 } from "../../lib/uuid";
import { environmentServerConfigsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { resolveThreadPrBadgeAction } from "../../state/thread-pr-presentation";
import { threadCanArchive } from "../home/threadArchive";
import { useThreadListActions } from "../home/useThreadListActions";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import { resolveThreadPullRequest } from "./thread-panel";
import {
  buildThreadTitleMenu,
  type ThreadTitleMenuAction,
  type ThreadTitleMenuItem,
} from "./thread-title-menu";
import { resolveThreadListV2SnoozeMenuSelection } from "./threadListV2";
import { useOpenThreadPullRequests } from "./use-open-thread-pull-requests";

type NativeMenu = HeaderBarButtonItemWithMenu["menu"];

/**
 * The thread title's native menu, run through the thread list's commands and confirmations.
 * The overlay holds the custom snooze sheet and renders beside the header.
 */
export function useThreadTitleMenu(input: {
  readonly thread: EnvironmentThreadShell | null;
  /** False while a client-only creation prepares, before the server owns the thread. */
  readonly canMutate: boolean;
  readonly path: string | null;
  readonly gitStatus: VcsStatusResult | null;
  readonly onMergeBack: (() => void) | undefined;
}) {
  const { thread } = input;
  const configs = useAtomValue(environmentServerConfigsAtom);
  const canOperate = useEnvironmentScope(
    thread?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const actions = useThreadListActions();
  const selectDetail = useSelectWorkspaceDetail();
  const openThreadPullRequests = useOpenThreadPullRequests();
  // Snooze presets name clock times, so the menu follows the minute.
  const now = new Date(useNowMinuteMs());
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  if (thread === null) return { menu: undefined, overlay: null };

  const config = configs.get(thread.environmentId);
  const capabilities = config?.environment.capabilities;
  const supports = {
    settlement: capabilities?.threadSettlement === true,
    autoSettleOptOut: capabilities?.threadAutoSettleOptOut === true,
    snooze: capabilities?.threadSnooze === true,
    pinning: capabilities?.threadPinning === true,
    titleRegeneration: capabilities?.threadTitleRegeneration === true,
  };
  const presetSettings = config?.settings.snoozePresets;
  const snoozePresets = resolveSnoozePresets(
    now,
    presetSettings ? { presets: presetSettings } : {},
  );
  const pullRequest = resolveThreadPullRequest({
    thread,
    supportsLinks: capabilities?.threadPullRequests === true,
    gitStatus: input.gitStatus,
  });
  const groups = buildThreadTitleMenu({
    canOperate: canOperate && input.canMutate,
    branch: thread.branch,
    hasPath: input.path !== null,
    isPinned: thread.pinnedAt != null,
    isSettled: supports.settlement && thread.settledOverride === "settled",
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: supports.snooze && effectiveSnoozed(thread, { now: now.toISOString() }),
    canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
    isRegeneratingTitle: thread.titleRegeneration != null,
    isRunning: !threadCanArchive(thread.runtime),
    supports,
    snoozePresets,
    pullRequestLabel: pullRequest
      ? resolveThreadPrBadgeAction(pullRequest).kind === "list"
        ? `Show linked ${pullRequest.changeRequest.plural}`
        : `Open ${pullRequest.changeRequest.singular}`
      : null,
    canMergeBack: input.onMergeBack !== undefined,
  });

  const run = (id: ThreadTitleMenuAction) => {
    switch (id) {
      case "new-thread-on-branch":
        selectDetail({
          name: "Thread",
          params: {
            draft: {
              requestId: uuidv4(),
              environmentId: String(thread.environmentId),
              projectId: String(thread.projectId),
              branch: thread.branch,
              worktreePath: thread.worktreePath,
            },
          },
        });
        return;
      case "pin":
        void actions.pinThread(thread);
        return;
      case "unpin":
        void actions.unpinThread(thread);
        return;
      case "settle":
        void actions.settleThread(thread);
        return;
      case "unsettle":
        void actions.unsettleThread(thread);
        return;
      case "unsnooze":
        void actions.unsnoozeThread(thread);
        return;
      case "snooze:custom":
        setCustomSnoozeOpen(true);
        return;
      case "rename":
        actions.renameThread(thread);
        return;
      case "regenerate-title":
        void actions.regenerateThreadTitle(thread);
        return;
      case "auto-settle:enabled":
      case "auto-settle:disabled":
        void actions.setThreadAutoSettle(thread, id === "auto-settle:enabled");
        return;
      case "open-pull-request":
        if (pullRequest) openThreadPullRequests(thread, pullRequest);
        return;
      case "merge-back":
        input.onMergeBack?.();
        return;
      case "copy-path":
        if (input.path) copyTextWithHaptic(input.path, { target: "path" });
        return;
      case "copy-branch":
        if (thread.branch) copyTextWithHaptic(thread.branch, { target: "branch" });
        return;
      case "copy-thread-id":
        copyTextWithHaptic(thread.id, { target: "thread-id" });
        return;
      case "archive":
        void actions.archiveThread(thread);
        return;
      case "delete":
        actions.confirmDeleteThread(thread);
        return;
    }
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event: id,
      displayedPresets: snoozePresets,
      // oxlint-disable-next-line react/purity -- Runs when an item is chosen, not during render.
      now: new Date(),
      presets: presetSettings,
    });
    if (selection._tag === "selected")
      void actions.snoozeThread(thread, selection.preset.snoozedUntil);
    else if (selection._tag === "expired")
      Dialog.alert("Could not snooze thread", "That snooze time has passed. Choose another time.");
  };
  // UIKit cannot disable a submenu, so a disabled one shows as a disabled action.
  const toNative = (item: ThreadTitleMenuItem): NativeMenu["items"][number] =>
    item.children && !item.disabled
      ? { type: "submenu", title: item.label, items: item.children.map(toNative) }
      : {
          type: "action",
          title: item.label,
          subtitle: item.description,
          icon: item.icon ? { type: "sfSymbol", name: item.icon } : undefined,
          disabled: item.disabled,
          destructive: item.destructive,
          state: item.checked === undefined ? undefined : item.checked ? "on" : "off",
          onPress: () => run(item.id),
        };
  const menu: NativeMenu = {
    items: groups.map((group) => ({
      type: "submenu",
      title: "",
      displayInline: true,
      items: group.map(toNative),
    })),
  };
  return {
    menu,
    overlay: customSnoozeOpen ? (
      <CustomSnoozeSheet
        onClose={() => setCustomSnoozeOpen(false)}
        onSnooze={(snoozedUntil) => void actions.snoozeThread(thread, snoozedUntil)}
      />
    ) : null,
  };
}
