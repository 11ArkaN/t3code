import { useClientSettings } from "~/hooks/useSettings";
import { useState } from "react";

import { Button } from "~/components/ui/button";

import { describePreviewError } from "./errorCodeMessages";

interface Props {
  url: string;
  code: number;
  description: string;
  onReload: () => void;
  move?: { readonly label: string; readonly onMove: () => void };
}

export function PreviewFileNotShown({
  url,
  fileName,
  downloadUrl,
  onOpen,
}: {
  url: string;
  fileName: string;
  downloadUrl: string | null;
  onOpen: () => void;
}) {
  const redesign = useClientSettings((s) => s.redesignEnabled);
  const host = safeHost(url) ?? url;
  return (
    <div className="scrollbar-gutter-both relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 py-12 sm:py-16 redesign:max-w-md redesign:px-6 redesign:py-10 redesign:sm:py-10">
        <ErrorIcon className="mb-6 size-12 text-muted-foreground/70 redesign:mb-5 redesign:size-8 redesign:text-secondary-label" />
        <h1 className="mb-3 text-2xl font-semibold leading-tight text-foreground redesign:mb-2 redesign:text-balance redesign:text-base">
          This file can&rsquo;t be shown here
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground redesign:break-words redesign:text-pretty redesign:text-sm redesign:text-secondary-label">
          <span className="font-semibold text-foreground">{fileName}</span> from {host} was
          downloaded instead.
        </p>
        <div className="mt-auto flex items-center gap-2 pt-8 redesign:mt-6 redesign:flex-wrap redesign:pt-0">
          <div className="flex-1 redesign:hidden" />
          <Button type="button" variant="outline" size="sm" onClick={onOpen}>
            Open in browser
          </Button>
          {downloadUrl ? (
            <Button
              type="button"
              variant={redesign ? "secondary" : "default"}
              size="sm"
              render={<a href={downloadUrl} download={fileName} />}
            >
              Download
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PreviewUnreachable({ url, code, description, onReload, move }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const redesign = useClientSettings((s) => s.redesignEnabled);
  const host = safeHost(url) ?? url;
  const friendly = describePreviewError(description);
  const errorLabel = description.length > 0 ? description : `ERR_${Math.abs(code) || "FAILED"}`;

  return (
    <div className="scrollbar-gutter-both relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 py-12 sm:py-16 redesign:max-w-md redesign:px-6 redesign:py-10 redesign:sm:py-10">
        <ErrorIcon className="mb-6 size-12 text-muted-foreground/70 redesign:mb-5 redesign:size-8 redesign:text-secondary-label" />
        <h1 className="mb-3 text-2xl font-semibold leading-tight text-foreground redesign:mb-2 redesign:text-balance redesign:text-base">
          This site can&rsquo;t be reached
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground redesign:break-words redesign:text-pretty redesign:text-sm redesign:text-secondary-label">
          <span className="font-semibold text-foreground">{host}</span>: {friendly}.
        </p>

        {showDetails ? (
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm redesign:mt-5 redesign:border-0 redesign:bg-foreground/4 redesign:p-3 redesign:text-xs">
            <p className="mb-2 font-medium text-foreground">Try:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Checking your connection</li>
              <li>Confirming the dev server is running</li>
              {move ? (
                <li>Opening it in the environment&rsquo;s browser, which reaches its network</li>
              ) : null}
              <li>Checking the proxy and the firewall</li>
            </ul>
          </div>
        ) : null}

        <div className="mt-8 text-xs uppercase tracking-wide text-muted-foreground/70 redesign:mt-4 redesign:break-all redesign:font-mono redesign:normal-case redesign:tracking-normal redesign:text-secondary-label">
          {errorLabel}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-8 redesign:mt-6 redesign:flex-wrap redesign:pt-0">
          <Button
            type="button"
            variant={redesign ? "ghost-muted" : "outline"}
            size="sm"
            onClick={() => setShowDetails((value) => !value)}
          >
            {showDetails ? "Hide details" : "Details"}
          </Button>
          <div className="flex-1 redesign:hidden" />
          {move ? (
            <Button type="button" variant="outline" size="sm" onClick={move.onMove}>
              {move.label}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={redesign ? "secondary" : "default"}
            size="sm"
            onClick={onReload}
          >
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={className}
    >
      <path d="M16 12 L48 12 L48 52 L16 52 Z" />
      <path d="M22 22 L42 22 M22 30 L36 30 M22 38 L40 38" strokeLinecap="round" />
      <path d="M52 8 L12 56" strokeLinecap="round" />
    </svg>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
