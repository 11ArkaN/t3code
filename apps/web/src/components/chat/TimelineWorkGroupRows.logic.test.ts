import { describe, expect, it } from "vite-plus/test";

import { formatWorkingTimerNow } from "./TimelineWorkGroupRows.logic";

describe("formatWorkingTimerNow", () => {
  it("counts real elapsed time when the server clock runs ahead of the browser", () => {
    const mountedAtMs = Date.parse("2026-10-26T12:00:00.000Z");
    const serverCreatedAt = "2026-10-26T13:00:00.000Z";

    expect(formatWorkingTimerNow(serverCreatedAt, mountedAtMs, mountedAtMs)).toBe("0s");
    expect(formatWorkingTimerNow(serverCreatedAt, mountedAtMs, mountedAtMs + 30_000)).toBe("30s");
  });

  it("counts from the server start when it is not in the future", () => {
    const mountedAtMs = Date.parse("2026-10-26T12:00:00.000Z");
    const serverCreatedAt = "2026-10-26T11:58:00.000Z";

    expect(formatWorkingTimerNow(serverCreatedAt, mountedAtMs, mountedAtMs + 5_000)).toBe("2m 5s");
  });
});
