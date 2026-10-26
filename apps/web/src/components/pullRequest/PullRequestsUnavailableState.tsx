import { useClientSettings } from "~/hooks/useSettings";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ExternalLinkIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { PullRequestGlyph } from "./pullRequestIcons";

export function PullRequestsUnavailableState({
  title = "Could not load pull requests",
  error,
  onRetry,
  refreshing = false,
  host,
}: {
  title?: string;
  error: string;
  onRetry?: () => void;
  refreshing?: boolean;
  host?: { readonly url: string; readonly openLabel: string };
}) {
  const redesign = useClientSettings((settings) => settings.redesignEnabled);
  return (
    <Empty
      size={redesign ? "compact" : "default"}
      className="scrollbar-gutter-both min-h-0 justify-center-safe overflow-y-auto [&>*]:shrink-0"
    >
      {redesign ? (
        <span className="flex size-10 items-center justify-center rounded-xl bg-foreground/5 text-secondary-label">
          <PullRequestGlyph.pullRequest aria-hidden className="size-5" />
        </span>
      ) : (
        <EmptyMedia variant="icon">
          <PullRequestGlyph.pullRequest />
        </EmptyMedia>
      )}
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{error}</EmptyDescription>
      </EmptyHeader>
      {onRetry || host ? (
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <RefreshIcon size="sm" refreshing={refreshing} />
              Retry
            </Button>
          ) : null}
          {host ? (
            <Button
              size="sm"
              variant="outline"
              render={<a href={host.url} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              {host.openLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Empty>
  );
}
