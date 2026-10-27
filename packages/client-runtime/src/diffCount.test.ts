import { describe, expect, it, vi } from "vite-plus/test";

describe("formatDiffCount", () => {
  it("groups line counts in thousands even where the host would use lakhs", async () => {
    const lakhGrouping = new Intl.NumberFormat("en-IN").format(381_102);
    vi.resetModules();
    const numberFormat = vi.spyOn(Intl, "NumberFormat");
    const { formatDiffCount } = await import("./diffCount.ts");

    expect(lakhGrouping).toBe("3,81,102");
    expect(formatDiffCount(381_102)).toBe("381,102");
    expect(formatDiffCount(83_065)).toBe("83,065");
    expect(formatDiffCount(0)).toBe("0");
    expect(numberFormat.mock.calls[0]?.[0]).toBe("en-US");

    numberFormat.mockRestore();
  });
});
