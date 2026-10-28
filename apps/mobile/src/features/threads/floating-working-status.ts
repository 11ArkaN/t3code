import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

export interface FloatingStatusAction {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

export type FloatingWorkingStatus =
  | { readonly kind: "working"; readonly startedAt: string }
  | { readonly kind: "syncing"; readonly label: string }
  | { readonly kind: "compacting" }
  | {
      readonly kind: "child-input";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly onPress: () => void;
    }
  | {
      readonly kind: "background";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly waiting: boolean;
      readonly onPress: () => void;
      readonly action: FloatingStatusAction;
    }
  | {
      readonly kind: "lifecycle";
      readonly state: "snoozed" | "settled" | "woke";
      readonly label: string;
      readonly action: FloatingStatusAction;
    }
  | { readonly kind: "goal"; readonly label: string; readonly accessibilityLabel: string }
  | { readonly kind: "preparing"; readonly label: string }
  | {
      readonly kind: "connection";
      readonly tone: "reconnecting" | "unavailable";
      readonly label: string;
      readonly onPress: () => void;
    };

/**
 * Segments of the run status row iOS docks to the composer, in desktop's order. Scroll-to-end
 * joins a row that is already showing: on its own it must not resize the row, or every drag
 * at the end of the feed would move the feed.
 */
export function runStatusSegments(input: {
  readonly status: FloatingWorkingStatus | null;
  readonly hasAgents: boolean;
  readonly queuedCount: number;
  readonly previewCount: number;
  readonly showScrollToEnd: boolean;
}) {
  const shown = {
    status: input.status !== null,
    agents: input.hasAgents,
    queue: input.queuedCount > 0,
    previews: input.previewCount > 0,
  };
  const segments = (["status", "agents", "queue", "previews"] as const).filter(
    (segment) => shown[segment],
  );
  return segments.length > 0 && input.showScrollToEnd
    ? [...segments, "scroll-to-end" as const]
    : segments;
}

export type RunStatusSegment = ReturnType<typeof runStatusSegments>[number];

/**
 * The feed's end inset. The docked iOS row is already inside the measured composer block;
 * Android's floating capsule draws above the block, so its coverage is added.
 */
export function feedEndInset(input: {
  readonly docksRunStatus: boolean;
  readonly composerBlock: number;
  readonly runStatus: number;
  readonly questionCard: number;
}): number {
  "worklet";
  return input.composerBlock + (input.docksRunStatus ? 0 : input.runStatus) + input.questionCard;
}

export function connectionFloatingStatus(input: {
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly environmentLabel: string | null;
  readonly onReconnect: () => void;
}): FloatingWorkingStatus | null {
  const environmentLabel = input.environmentLabel ?? "Environment";
  const unavailable = (label: string): FloatingWorkingStatus => ({
    kind: "connection",
    tone: "unavailable",
    label,
    onPress: input.onReconnect,
  });

  switch (input.connectionState) {
    case "connecting":
    case "reconnecting":
      return {
        kind: "connection",
        tone: "reconnecting",
        label:
          input.connectionError === null
            ? `Reconnecting to ${environmentLabel}...`
            : `Failed to connect. Retrying ${environmentLabel}...`,
        onPress: input.onReconnect,
      };
    case "offline":
      return unavailable("You are offline");
    case "unsupported":
      return unavailable("Client not supported");
    case "error":
      return unavailable(
        input.connectionError
          ? `Failed to connect to ${environmentLabel}: ${input.connectionError}`
          : `Failed to connect to ${environmentLabel}`,
      );
    case "available":
      return unavailable(`${environmentLabel} is not connected`);
    case "connected":
      return null;
  }
}
