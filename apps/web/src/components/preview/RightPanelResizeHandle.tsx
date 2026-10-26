import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props {
  handlers: ResizableWidthHandlers;
  className?: string;
}

export function RightPanelResizeHandle({ handlers, className }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={cn(
        "group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize select-none",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60 redesign:group-hover:bg-foreground/25 redesign:group-active:bg-foreground/50"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 hidden h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25 opacity-0 redesign:block group-hover:opacity-100 group-active:opacity-100"
      />
    </div>
  );
}
