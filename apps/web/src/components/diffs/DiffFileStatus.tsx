import { InfoIcon, RotateCwIcon } from "lucide-react";
import { useClientSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function DiffFileStatus({
  error,
  truncated,
  retry,
}: {
  error?: boolean | undefined;
  truncated?: boolean | undefined;
  retry: () => void;
}) {
  const redesignEnabled = useClientSettings((settings) => settings.redesignEnabled);
  if (!error && !truncated) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size={redesignEnabled ? "micro" : "icon-micro"}
            variant="ghost-muted"
            aria-label={error ? "Retry loading diff" : "Partial diff preview"}
            onClick={(event) => {
              event.stopPropagation();
              if (error) retry();
            }}
          />
        }
      >
        {error ? <RotateCwIcon className="size-3" /> : <InfoIcon className="size-3" />}
        {redesignEnabled ? (error ? "Retry" : "Partial") : null}
      </TooltipTrigger>
      <TooltipPopup>
        {error
          ? "Retry loading diff"
          : "This file is too large to show in full. Counts include all changes."}
      </TooltipPopup>
    </Tooltip>
  );
}
