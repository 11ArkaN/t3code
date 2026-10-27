import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

export type ThreadTitleMenuAction =
  | "new-thread-on-branch"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "open-pull-request"
  | "merge-back"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread-id"
  | "archive"
  | "delete";

export interface ThreadTitleMenuItem {
  readonly id: ThreadTitleMenuAction;
  readonly label: string;
  readonly icon?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly checked?: boolean;
  readonly children?: ReadonlyArray<ThreadTitleMenuItem>;
}

export interface ThreadTitleMenuState {
  readonly canOperate: boolean;
  readonly branch: string | null;
  readonly hasPath: boolean;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so it is disabled while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  readonly pullRequestLabel: string | null;
  readonly canMergeBack: boolean;
}

// Navigation and copying stay available to read-only connections, as on desktop.
const READ_ONLY_ACTIONS: ReadonlySet<ThreadTitleMenuAction> = new Set([
  "new-thread-on-branch",
  "open-pull-request",
  "copy",
  "copy-path",
  "copy-branch",
  "copy-thread-id",
]);

/**
 * Desktop's thread action menu (apps/web/src/components/threadActionMenu.logic.ts) with the
 * actions mobile has commands for, in the same groups. Mobile adds a group for the pull request
 * and merge back, which desktop keeps in its panels.
 */
export function buildThreadTitleMenu(
  state: ThreadTitleMenuState,
): ReadonlyArray<ReadonlyArray<ThreadTitleMenuItem>> {
  const groups: ReadonlyArray<ReadonlyArray<ThreadTitleMenuItem>> = [
    [
      ...(state.branch
        ? [
            {
              id: "new-thread-on-branch" as const,
              label: `New thread on ${state.branch}`,
              icon: "square.and.pencil",
            },
          ]
        : []),
      ...(state.supports.pinning
        ? [
            state.isPinned
              ? { id: "unpin" as const, label: "Unpin thread", icon: "pin.slash" }
              : { id: "pin" as const, label: "Pin thread", icon: "pin" },
          ]
        : []),
      ...(state.supports.settlement
        ? [
            state.isSettled
              ? { id: "unsettle" as const, label: "Un-settle thread", icon: "arrow.uturn.backward" }
              : { id: "settle" as const, label: "Settle thread", icon: "checkmark" },
          ]
        : []),
      ...(state.supports.snooze
        ? [
            state.isSnoozed
              ? { id: "unsnooze" as const, label: "Wake thread", icon: "clock" }
              : {
                  id: "snooze" as const,
                  label: "Snooze",
                  icon: "clock",
                  disabled: !state.canSnoozeNow,
                  children: [
                    ...state.snoozePresets.map((preset) => ({
                      id: `snooze:${preset.id}` as const,
                      label: preset.label,
                      description: preset.whenLabel,
                    })),
                    { id: "snooze:custom" as const, label: "Custom…" },
                  ],
                },
          ]
        : []),
    ],
    [
      { id: "rename", label: "Rename thread", icon: "pencil" },
      ...(state.supports.titleRegeneration
        ? [
            {
              id: "regenerate-title" as const,
              label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
              icon: "arrow.clockwise",
              disabled: state.isRegeneratingTitle,
            },
          ]
        : []),
      ...(state.supports.autoSettleOptOut
        ? [
            {
              id: "auto-settle" as const,
              label: "Auto-settle behavior",
              icon: "timer",
              children: [
                {
                  id: "auto-settle:enabled" as const,
                  label: "Enabled",
                  checked: state.autoSettleEnabled,
                },
                {
                  id: "auto-settle:disabled" as const,
                  label: "Disabled",
                  checked: !state.autoSettleEnabled,
                },
              ],
            },
          ]
        : []),
    ],
    [
      ...(state.pullRequestLabel
        ? [
            {
              id: "open-pull-request" as const,
              label: state.pullRequestLabel,
              icon: PullRequestGlyph.pullRequest,
            },
          ]
        : []),
      ...(state.canMergeBack
        ? [
            {
              id: "merge-back" as const,
              label: "Merge back to source",
              icon: PullRequestGlyph.merged,
            },
          ]
        : []),
    ],
    [
      {
        id: "copy",
        label: "Copy",
        icon: "doc.on.doc",
        children: [
          ...(state.hasPath ? [{ id: "copy-path" as const, label: "Path", icon: "folder" }] : []),
          ...(state.branch
            ? [
                {
                  id: "copy-branch" as const,
                  label: "Branch",
                  icon: "point.topleft.down.curvedto.point.bottomright.up",
                },
              ]
            : []),
          { id: "copy-thread-id", label: "Thread ID", icon: "number" },
        ],
      },
    ],
    [
      { id: "archive", label: "Archive thread", icon: "archivebox", disabled: state.isRunning },
      { id: "delete", label: "Delete", icon: "trash", destructive: true },
    ],
  ];
  const disableForReadOnly = (item: ThreadTitleMenuItem): ThreadTitleMenuItem =>
    READ_ONLY_ACTIONS.has(item.id)
      ? item
      : {
          ...item,
          disabled: true,
          ...(item.children ? { children: item.children.map(disableForReadOnly) } : {}),
        };
  return groups
    .filter((group) => group.length > 0)
    .map((group) => (state.canOperate ? group : group.map(disableForReadOnly)));
}
