import type { ToolCallDiffTarget } from "../diffPanelStore";
import type { ChatFileAttachment } from "../types";

/** Whether an event started in the side chat pane (`data-side-chat-pane`), which the main chat ignores. */
export function isInSideChatPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-side-chat-pane]") !== null;
}

/** Where an embedded side chat opens attachments and tool diffs: its parent's right panel. */
export interface SideChatParentPanel {
  readonly openToolDiff: (target: ToolCallDiffTarget) => void;
  readonly openFileAttachment: (attachment: ChatFileAttachment) => void;
}
