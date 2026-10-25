import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { CodeFontPreview } from "./SettingsFontPreviews";

describe("CodeFontPreview", () => {
  it("detaches its highlighted diff without throwing", async () => {
    // The preview renders no links and reads no route.
    await using screen = await render(<CodeFontPreview />, { router: false });
    await vi.waitFor(() => {
      const host = [...screen.container.querySelectorAll("div")].find((node) => node.shadowRoot);
      expect(host?.shadowRoot?.textContent).toContain("formatUser");
    });

    await expect(screen.unmount()).resolves.toBeUndefined();
  });
});
