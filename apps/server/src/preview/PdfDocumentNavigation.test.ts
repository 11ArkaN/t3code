import type { CDPSession } from "playwright-core";
import { describe, expect, it, vi } from "vite-plus/test";

import { installPdfDocumentNavigation } from "./PdfDocumentNavigation.ts";

const source = "https://environment.test/api/assets/signed-token/files/Study%20guide.PDF";

function fixture(nativePdfViewer = false) {
  const completed = Promise.withResolvers<{ method: string; params: Record<string, unknown> }>();
  let paused: (event: {
    requestId: string;
    frameId: string;
    request: { url: string; method: string };
    responseStatusCode: number;
    responseHeaders: Array<{ name: string; value: string }>;
  }) => void = () => {
    throw new Error("Navigation handler was not installed");
  };
  const send = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "Runtime.evaluate") return { result: { value: nativePdfViewer } };
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
    if (
      method === "Fetch.fulfillRequest" ||
      method === "Fetch.continueRequest" ||
      method === "Fetch.failRequest"
    ) {
      completed.resolve({ method, params });
    }
    return {};
  });
  const cdp = {
    send,
    on: (_name: string, listener: typeof paused) => {
      paused = listener;
    },
  } as unknown as CDPSession;
  return {
    cdp,
    send,
    navigate: (
      url = source,
      frameId = "main",
      method = "GET",
      status = 200,
      headers: string | Array<{ name: string; value: string }> = "application/pdf",
    ) => {
      paused({
        requestId: "request-1",
        frameId,
        request: { url, method },
        responseStatusCode: status,
        responseHeaders:
          typeof headers === "string" ? [{ name: "Content-Type", value: headers }] : headers,
      });
      return completed.promise;
    },
  };
}

describe("PDF document navigation", () => {
  it("escapes filenames in the browser document", async () => {
    const test = fixture();
    await installPdfDocumentNavigation(test.cdp);
    const result = await test.navigate(
      "https://environment.test/api/assets/token/%3Cscript%3E.pdf",
    );
    expect(Buffer.from(String(result.params.body), "base64").toString()).toContain(
      "<title>&lt;script>.pdf</title>",
    );
  });

  it("says a PDF from any site cannot be shown instead of downloading it", async () => {
    const test = fixture();
    await installPdfDocumentNavigation(test.cdp);
    const url = "https://example.com/papers/paper.pdf";
    const result = await test.navigate(url);
    expect(result.method).toBe("Fetch.fulfillRequest");
    const body = Buffer.from(String(result.params.body), "base64").toString();
    expect(body).toContain("paper.pdf");
    expect(body).toMatch(/can(not|'t) (be )?(displayed|rendered|shown)/i);
    // The fixture pauses every request; the real browser only pauses enabled patterns.
    const { patterns } = test.send.mock.calls.find(([method]) => method === "Fetch.enable")![1] as {
      patterns: Array<{ urlPattern: string }>;
    };
    const glob = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
    expect(patterns).toSatisfy((enabled: typeof patterns) =>
      enabled.some(({ urlPattern }) => glob(urlPattern).test(url)),
    );
  });

  it("leaves external pages and PDF downloads to the browser", async () => {
    const outcome = async (headers: Array<{ name: string; value: string }>) => {
      const test = fixture();
      await installPdfDocumentNavigation(test.cdp);
      return (await test.navigate("https://example.com/download?id=7", "main", "GET", 200, headers))
        .method;
    };
    const pdf = { name: "Content-Type", value: "Application/PDF" };
    expect(await outcome([{ name: "Content-Type", value: "text/html" }])).toBe(
      "Fetch.continueRequest",
    );
    expect(
      await outcome([pdf, { name: "Content-Disposition", value: 'attachment; filename="a.pdf"' }]),
    ).toBe("Fetch.continueRequest");
    expect(await outcome([pdf])).toBe("Fetch.fulfillRequest");
  });

  it("resumes navigation when committing the document fails", async () => {
    const test = fixture();
    await installPdfDocumentNavigation(test.cdp);
    test.send.mockRejectedValueOnce(new Error("Tab closed"));
    expect(await test.navigate()).toEqual({
      method: "Fetch.continueRequest",
      params: { requestId: "request-1" },
    });
  });
});
