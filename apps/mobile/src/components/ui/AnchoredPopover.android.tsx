import type { AnchoredPopover as IosAnchoredPopover } from "./AnchoredPopover";

/** Android keeps its sheets; no caller mounts a popover there. */
export function AnchoredPopover(_props: Parameters<typeof IosAnchoredPopover>[0]) {
  return null;
}
