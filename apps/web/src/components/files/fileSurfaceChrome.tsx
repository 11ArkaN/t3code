import type { ReactNode } from "react";
import { FileWarningIcon } from "lucide-react";

import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { DIFF_SURFACE_THEME_UNSAFE_CSS } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { useClientSettings } from "~/hooks/useSettings";

export const FILE_SURFACE_SUBHEADER_CLASS =
  "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent redesign:gap-1 redesign:border-transparent redesign:px-4 redesign:in-data-[preview-panel-mode=inline]:mb-1";

export const FILE_LINK_REVEAL_ATTRIBUTE = "data-file-link-reveal";

export const FILE_LINK_REVEAL_UNSAFE_CSS = `
  ${DIFF_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }

  /* Tint through --diffs-line-bg, not background-color. The editor paints row
     tints on a layer below its text selection; a background on the row itself
     covers the selection and makes selected text on this line invisible. */
  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-line] {
    --diffs-line-bg: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 82%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      )
    ) !important;
  }

  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-column-number] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 60%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      )
    ) !important;
    color: var(--diffs-selection-number-fg) !important;
  }
`;

export function FileSurfaceAction(props: {
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  const pressed = props.pressed;
  const redesign = useClientSettings((settings) => settings.redesignEnabled);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          redesign ? (
            <button
              type="button"
              className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/30 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-foreground [&_svg]:pointer-events-none"
              disabled={props.disabled ?? false}
              onClick={props.onPress}
              aria-label={props.label}
              aria-pressed={pressed}
            >
              {props.children}
            </button>
          ) : pressed === undefined ? (
            <Button
              type="button"
              className="shrink-0"
              disabled={props.disabled ?? false}
              onClick={props.onPress}
              aria-label={props.label}
              variant="ghost"
              size="icon-sm"
            >
              {props.children}
            </Button>
          ) : (
            <Toggle
              className="shrink-0"
              pressed={pressed}
              disabled={props.disabled ?? false}
              onPressedChange={props.onPress}
              aria-label={props.label}
              variant="ghost"
              size="sm"
            >
              {props.children}
            </Toggle>
          )
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function FileSurfaceNotice(props: { readonly children: ReactNode }) {
  return (
    <div
      role="status"
      className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground redesign:mx-4 redesign:mb-3 redesign:rounded-lg redesign:border redesign:px-3 redesign:py-2 redesign:text-xs redesign:leading-relaxed"
    >
      {props.children}
    </div>
  );
}

export function FileSurfaceLoading(props: { readonly className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading file"
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center text-muted-foreground redesign:flex-col redesign:gap-3 redesign:p-6",
        props.className,
      )}
    >
      <Spinner size="lg" />
      <span className="hidden text-xs text-secondary-label redesign:block">Loading preview…</span>
    </div>
  );
}

export function FileSurfaceFailure(props: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed redesign:gap-2 redesign:py-8"
    >
      <FileWarningIcon
        aria-hidden
        className="hidden size-6 text-muted-foreground redesign:mb-2 redesign:block"
      />
      <p className="hidden text-base font-semibold redesign:block">Preview unavailable</p>
      <p className="text-destructive redesign:max-w-sm redesign:text-sm redesign:text-secondary-label redesign:text-balance">
        {props.message}
      </p>
      {props.onRetry ? (
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-md border border-input px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring redesign:mt-2 redesign:border-transparent redesign:bg-accent redesign:px-3 redesign:py-2 redesign:focus-visible:ring-foreground/30"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
