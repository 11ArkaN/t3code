import { createContext, type ReactNode } from "react";

export const NativeWorkspaceModeContext = createContext(false);
export const NativePrimaryColumnContext = createContext<{
  readonly presented: boolean;
  readonly selectedThreadKey: string | null;
  readonly selectedPullRequestKey: string | null;
} | null>(null);
export const NativeWorkspaceInspectorContext = createContext<{
  readonly render: (() => ReactNode) | undefined;
  readonly visible: boolean;
}>({ render: undefined, visible: false });
