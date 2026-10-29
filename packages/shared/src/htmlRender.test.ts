import { describe, expect, it } from "vite-plus/test";

import { flattenThemeColor } from "./colorContrast.ts";
import {
  htmlRenderTheme,
  injectHtmlRenderBootstrap,
  readHtmlRenderImageRequest,
  readHtmlRenderLinkRequest,
} from "./htmlRender.ts";
import { T3_CODE_DARK_THEME_COLORS, T3_CODE_LIGHT_THEME_COLORS } from "./themePalettes.ts";
import { htmlRenderFromToolItem } from "./toolOutput.ts";

const reference = { attachmentId: "thread-abc-123.html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="t3-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
    expect(injected).toContain('name="viewport"');
  });

  it("wraps fragments without a head and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it.each(["textarea", "iframe", "plaintext"])("keeps the bootstrap outside %s content", (tag) => {
    const fragment = `<${tag}><head><meta name="viewport"></head></${tag}>`;
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf(`<${tag}>`));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it.each([
    '<template><head><meta name="viewport"></head></template>',
    '<template><template>inner</template><head><meta name="viewport"></head></template>',
  ])("keeps the bootstrap outside inert template content: %s", (fragment) => {
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf("<template>"));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it("ignores tags written inside comments and scripts", () => {
    const html =
      '<!-- copy <head> and <meta name="viewport"> here --><html><head>' +
      "<script>const tag = '<meta name=\"viewport\">';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="t3-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
  });
});

function relativeLuminance(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("htmlRenderTheme", () => {
  it.each([
    { appearance: "dark", base: T3_CODE_DARK_THEME_COLORS, canvas: "#161515", accent: "#21180e" },
    { appearance: "light", base: T3_CODE_LIGHT_THEME_COLORS, canvas: "#fafafa", accent: "#ece6d8" },
  ] as const)(
    "keeps --accent and --chart-1 visible on a $appearance theme whose accent matches its canvas",
    ({ appearance, base, canvas, accent }) => {
      const { variables } = htmlRenderTheme({ ...base, canvas, accent }, appearance);
      const background = variables["--background"]!;
      for (const name of ["--accent", "--chart-1"]) {
        expect(
          contrastRatio(variables[name]!, background),
          `${name} ${variables[name]} contrast on --background ${background}`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("keeps a grey accent grey when it lifts it", () => {
    const { variables } = htmlRenderTheme(
      { ...T3_CODE_DARK_THEME_COLORS, canvas: "#0a0a0a", accent: "#262626" },
      "dark",
    );
    const accent = variables["--accent"]!;
    expect(contrastRatio(accent, "#0a0a0a")).toBeGreaterThanOrEqual(3);
    const channels = [1, 3, 5].map((start) => Number.parseInt(accent.slice(start, start + 2), 16));
    expect(
      Math.max(...channels) - Math.min(...channels),
      `${accent} is tinted`,
    ).toBeLessThanOrEqual(2);
  });

  it("keeps --accent-foreground readable on a lifted accent", () => {
    const { variables } = htmlRenderTheme(
      {
        ...T3_CODE_LIGHT_THEME_COLORS,
        canvas: "#808080",
        accent: "#808080",
        accentForeground: "#000000",
      },
      "light",
    );
    expect(
      contrastRatio(variables["--accent-foreground"]!, variables["--accent"]!),
      `${variables["--accent-foreground"]} on ${variables["--accent"]}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("replaces a translucent --accent-foreground on a lifted accent with an opaque readable one", () => {
    const { variables } = htmlRenderTheme(
      {
        ...T3_CODE_DARK_THEME_COLORS,
        canvas: "#161515",
        accent: "#21180e",
        accentForeground: "#ffffff80",
      },
      "dark",
    );
    const foreground = variables["--accent-foreground"]!;
    expect(foreground).toMatch(/^#[\da-f]{6}$/i);
    expect(contrastRatio(foreground, variables["--accent"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("measures a translucent accent as painted on the canvas", () => {
    const canvas = "#161515";
    const { variables } = htmlRenderTheme(
      { ...T3_CODE_DARK_THEME_COLORS, canvas, accent: "#ffffff10" },
      "dark",
    );
    for (const name of ["--accent", "--chart-1"]) {
      const painted = flattenThemeColor(variables[name]!, canvas);
      expect(
        contrastRatio(painted, canvas),
        `${name} ${variables[name]} paints ${painted} on ${canvas}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves the accent as given over a translucent canvas", () => {
    const colors = { ...T3_CODE_LIGHT_THEME_COLORS, canvas: "#73737300", accent: "#737373" };
    const { variables } = htmlRenderTheme(colors, "light");
    expect(variables["--accent"]).toBe("#737373");
    expect(variables["--chart-1"]).toBe("#737373");
    expect(variables["--accent-foreground"]).toBe(colors.accentForeground);
  });

  it("passes the T3 Code default themes' accent through unchanged", () => {
    for (const [colors, appearance] of [
      [T3_CODE_DARK_THEME_COLORS, "dark"],
      [T3_CODE_LIGHT_THEME_COLORS, "light"],
    ] as const) {
      const { variables } = htmlRenderTheme(colors, appearance);
      expect(variables["--accent"]).toBe(colors.accent);
      expect(variables["--chart-1"]).toBe(colors.accent);
    }
  });
});

describe("readHtmlRenderLinkRequest", () => {
  it("accepts only http(s) URLs in an MCP Apps ui/open-link request", () => {
    const link = (url: unknown, modifiers = {}) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url, ...modifiers },
    });
    expect(readHtmlRenderLinkRequest(link("https://example.com/a"))).toEqual({
      id: 1,
      url: "https://example.com/a",
      metaKey: false,
      ctrlKey: false,
    });
    expect(
      readHtmlRenderLinkRequest(link("https://example.com/a", { metaKey: true, ctrlKey: "yes" })),
    ).toEqual({ id: 1, url: "https://example.com/a", metaKey: true, ctrlKey: false });
    expect(readHtmlRenderLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readHtmlRenderLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://example.com" },
      }),
    ).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({ type: "t3-html-render-link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

describe("readHtmlRenderImageRequest", () => {
  it("accepts http(s) and inline image URLs in an open-image notification", () => {
    const image = (params: unknown) => ({
      jsonrpc: "2.0",
      method: "t3/notifications/open-image",
      params,
    });
    expect(
      readHtmlRenderImageRequest(image({ src: "data:image/png;base64,AA", name: " Chart " })),
    ).toEqual({
      src: "data:image/png;base64,AA",
      name: "Chart",
    });
    expect(readHtmlRenderImageRequest(image({ src: "https://example.com/a.png" }))).toEqual({
      src: "https://example.com/a.png",
      name: "Image",
    });
    expect(readHtmlRenderImageRequest(image({ src: "javascript:alert(1)" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "data:text/html,<p>" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "blob:null/1" }))).toBeUndefined();
  });
});

describe("htmlRenderFromToolItem", () => {
  const result = { htmlRender: reference, message: "Rendered above your reply." };

  it("reads the reference from each provider's result envelope", () => {
    for (const [toolName, output] of [
      ["mcp__t3-code__html_render", [{ type: "text", text: JSON.stringify(result) }]],
      ["t3-code.html_render", { structuredContent: result, content: [] }],
      ["t3-code-thread_1_html_render", JSON.stringify(result)],
      ["html_render", result],
    ] as const) {
      expect(htmlRenderFromToolItem({ toolName, output })).toEqual(reference);
    }
  });
});
