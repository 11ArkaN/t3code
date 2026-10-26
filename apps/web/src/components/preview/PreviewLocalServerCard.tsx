import { ArrowUpRight } from "lucide-react";
import { useClientSettings } from "~/hooks/useSettings";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { DiscoveryListRow } from "../ui/discovery-list";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  server: PreviewableServer;
  onOpen: () => void;
}

export function PreviewLocalServerCard({ threadRef, server, onOpen }: Props) {
  const redesign = useClientSettings((s) => s.redesignEnabled);
  const subtitle = describeServer(server);
  if (redesign)
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/40"
      >
        <span className="opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100">
          <PreviewFaviconIcon threadRef={threadRef} url={server.requestedUrl} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground/75 group-hover:text-foreground group-focus-visible:text-foreground">
            {subtitle}
          </span>
          <span className="truncate text-xs text-secondary-label">
            {server.host}:{server.port}
          </span>
        </span>
        <ArrowUpRight className="size-4 text-secondary-label group-hover:text-foreground group-focus-visible:text-foreground" />
      </button>
    );
  return (
    <DiscoveryListRow
      onClick={onOpen}
      icon={<PreviewFaviconIcon threadRef={threadRef} url={server.requestedUrl} />}
      title={subtitle}
      description={`${server.host}:${server.port}`}
    />
  );
}

function describeServer(server: PreviewableServer): string {
  if (server.processName) return server.processName;
  return "Listening";
}
