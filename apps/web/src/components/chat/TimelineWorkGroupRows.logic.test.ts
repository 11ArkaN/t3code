import { afterEach, describe, expect, it, vi } from "vitest";

import { formatWorkingTimerNow } from "./TimelineWorkGroupRows.logic";

describe("formatWorkingTimerNow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts real elapsed time when the server clock runs ahead of the browser", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-26T12:00:00.000Z"));
    const serverCreatedAt = "2026-10-26T13:00:00.000Z";

    expect(formatWorkingTimerNow(serverCreatedAt)).toBe("0s");
    vi.advanceTimersByTime(30_000);
    expect(formatWorkingTimerNow(serverCreatedAt)).toBe("30s");
  });
});
