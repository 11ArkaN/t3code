import type { ComponentProps, ReactNode } from "react";
import { TooltipPopup } from "./ui/tooltip";
import { cn } from "~/lib/utils";

export function ThreadHoverCardPopup({ className, ...props }: ComponentProps<typeof TooltipPopup>) {
  return (
    <TooltipPopup
      {...props}
      variant="glass"
      className={cn("max-w-80 text-left whitespace-normal", className)}
    />
  );
}

export function ThreadHoverCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2 redesign:gap-3 redesign:px-2 redesign:py-3">
      <div className="min-w-0 truncate text-xs leading-tight font-medium text-foreground redesign:line-clamp-2 redesign:whitespace-normal redesign:text-sm redesign:leading-snug redesign:font-semibold redesign:text-balance">
        {title}
      </div>
      <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground redesign:gap-2.5 redesign:pl-0 redesign:text-secondary-label">
        {children}
      </div>
      {footer}
    </div>
  );
}
