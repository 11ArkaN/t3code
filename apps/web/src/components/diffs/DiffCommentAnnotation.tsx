import { MessageCircle, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

interface DiffCommentSecondaryAction {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly allowEmpty?: boolean;
  readonly onAction: (text: string) => void;
}

interface DiffCommentAnnotationProps {
  kind: "draft" | "comment";
  rangeLabel: string;
  rangeDescription?: string;
  text: string;
  onTextChange?: (text: string) => void;
  onCancel: () => void;
  onComment: (text: string) => void;
  onDelete?: () => void;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  secondaryAction?: DiffCommentSecondaryAction;
  focusOnMount?: boolean;
}

export function DiffCommentAnnotation({
  kind,
  rangeLabel,
  rangeDescription: rangeDescriptionProp,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  secondaryAction,
  focusOnMount = true,
}: DiffCommentAnnotationProps) {
  const redesignEnabled = useClientSettings((settings) => settings.redesignEnabled);
  const rangeDescription = rangeDescriptionProp ?? `Lines ${rangeLabel}`;
  const [localDraftText, setLocalDraftText] = useState("");
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (kind !== "draft" || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, kind]);

  if (kind === "comment") {
    return (
      <div
        data-diff-comment-annotation
        className="group/comment flex min-w-0 items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground selection:bg-primary selection:text-primary-foreground redesign:mx-3 redesign:my-2 redesign:rounded-lg redesign:border redesign:border-border/60 redesign:bg-background redesign:py-3"
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircle
          className="size-3.5 h-5 shrink-0 text-primary/70 redesign:text-muted-foreground"
          aria-hidden="true"
        />
        <div className="contents redesign:block redesign:min-w-0 redesign:flex-1">
          <span className="mb-1 hidden text-xs text-secondary-label redesign:block">
            {rangeDescription}
          </span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5">{displayedText}</p>
        </div>
        {onDelete ? (
          <span className="-my-1 -mr-1 flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Delete comment"
              onClick={onDelete}
            >
              <Trash2 className="size-3" />
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  const editor = (
    <Textarea
      ref={textareaRef}
      unstyled={redesignEnabled}
      autoFocus={focusOnMount}
      size="sm"
      value={displayedText}
      placeholder={placeholder}
      aria-label={
        redesignEnabled ? `Comment on ${rangeDescription}` : `Comment on lines ${rangeLabel}`
      }
      onChange={(event) => (onTextChange ?? setLocalDraftText)(event.target.value)}
      onFocus={(event) => {
        const end = event.currentTarget.value.length;
        event.currentTarget.setSelectionRange(end, end);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (isCommentSubmitShortcut(event, trimmedText, pending)) {
          event.preventDefault();
          onComment(trimmedText);
        }
      }}
    />
  );

  // Pierre hides native carets and selection; textarea comments need their own visible feedback.
  return (
    <div
      data-diff-comment-annotation
      className="px-3 py-2 font-sans text-foreground caret-foreground selection:bg-primary selection:text-primary-foreground redesign:mx-3 redesign:my-2 redesign:rounded-xl redesign:border redesign:border-border/60 redesign:bg-background redesign:p-3"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 hidden items-center gap-2 text-xs text-secondary-label redesign:flex">
        <MessageCircle className="size-3.5" aria-hidden />
        <span>Comment on {rangeDescription}</span>
      </div>
      {redesignEnabled ? (
        <div className="rounded-lg border border-border bg-muted/20 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-foreground/60">
          {editor}
        </div>
      ) : (
        editor
      )}
      <div className="mt-1.5 flex items-center gap-1 redesign:mt-2 redesign:flex-wrap redesign:gap-2">
        <span className="mr-auto text-3xs text-muted-foreground/70 redesign:text-secondary-label">
          ⌘/Ctrl Enter to send
        </span>
        <Button variant="ghost-muted" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        {secondaryAction ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!secondaryAction.allowEmpty && !trimmedText}
            onClick={() => secondaryAction.onAction(trimmedText)}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant={redesignEnabled ? "secondary" : "default"}
          disabled={pending || !trimmedText}
          onClick={() => onComment(trimmedText)}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
