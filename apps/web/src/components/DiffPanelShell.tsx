import type { ReactNode } from "react";
import { FileDiffIcon } from "lucide-react";

import { isElectron } from "~/env";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "embedded";
  return cn(
    "flex items-center justify-between gap-2",
    mode === "embedded" ? "px-2" : "px-4",
    shouldUseDragRegion
      ? "drag-region h-[var(--workspace-topbar-height)] border-b border-border wco:pr-(--workspace-native-controls-inset)"
      : "flex h-10 min-h-10 shrink-0 items-center border-b border-border/60 bg-background in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent",
    "redesign:border-b-transparent redesign:px-3 redesign:in-data-[preview-panel-mode=inline]:mb-0",
  );
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: ReactNode;
  children: ReactNode;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
    >
      {shouldUseDragRegion ? (
        <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
      ) : (
        <div className={getDiffPanelHeaderRowClassName(props.mode)} data-surface-subheader>
          {props.header}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function DiffFileHeaderSkeleton({
  titleWidth,
}: {
  titleWidth: "short" | "medium" | "long";
}) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 pr-3 redesign:px-3">
      <div className="flex size-5 shrink-0 items-center justify-center">
        <Skeleton className="size-2.5" />
      </div>
      <Skeleton className="size-5 shrink-0" />
      <Skeleton
        shape="pill"
        className={
          titleWidth === "short"
            ? "h-3 w-2/5 max-w-52"
            : titleWidth === "medium"
              ? "h-3 w-1/2 max-w-64"
              : "h-3 w-3/5 max-w-72"
        }
      />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton shape="pill" className="h-3 w-5" />
        <Skeleton shape="pill" className="h-3 w-5" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton({ width }: { width: "short" | "medium" | "long" }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton shape="pill" className="h-2.5 w-5 shrink-0" />
      <Skeleton
        shape="pill"
        className={
          width === "short" ? "h-2.5 w-3/5" : width === "medium" ? "h-2.5 w-2/3" : "h-2.5 w-4/5"
        }
      />
    </div>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden bg-background redesign:px-1 redesign:pt-2"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <p className="hidden px-3 pb-2 text-xs text-secondary-label redesign:block">{props.label}</p>
      <DiffFileHeaderSkeleton titleWidth="medium" />
      <div className="flex h-6 items-center gap-2 px-2 pr-3">
        <div className="h-px flex-1 bg-border/40" />
        <Skeleton shape="pill" className="h-2.5 w-24" />
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton width="medium" />
        <DiffCodeLineSkeleton width="long" />
        <DiffCodeLineSkeleton width="short" />
      </div>
      <DiffFileHeaderSkeleton titleWidth="short" />
      <DiffFileHeaderSkeleton titleWidth="long" />
      <span className="sr-only">{props.label}</span>
    </div>
  );
}

export function DiffPanelEmptyState({
  title,
  children,
  className = "flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const redesignEnabled = useClientSettings((settings) => settings.redesignEnabled);
  if (!redesignEnabled) return <div className={className}>{children}</div>;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div className="flex max-w-72 flex-col items-center gap-2">
        <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
          <FileDiffIcon className="size-5" aria-hidden />
        </div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <div className="text-sm leading-5 text-balance text-secondary-label">{children}</div>
      </div>
    </div>
  );
}
