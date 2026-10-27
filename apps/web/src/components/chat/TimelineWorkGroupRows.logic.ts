import { formatDuration } from "@t3tools/shared/orchestrationTiming";

function formatWorkingTimer(startedAtMs: number, endedAtMs: number): string | null {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  return formatDuration(elapsedSeconds * 1_000);
}

// A server clock running ahead puts the start in the browser's future; count from mount instead.
export function formatWorkingTimerNow(
  startIso: string,
  mountedAtMs: number,
  nowMs: number,
): string {
  const startedAtMs = Math.min(Date.parse(startIso), mountedAtMs);
  return formatWorkingTimer(startedAtMs, nowMs) ?? "0s";
}
