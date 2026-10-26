import { constVoid } from "effect/Function";
import type { CDPSession } from "playwright-core";

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export const isPdfAssetUrl = (url: string) => {
  const { pathname } = new URL(url);
  return pathname.startsWith("/api/assets/") && /\.pdf$/i.test(pathname);
};

const fileName = (url: string) => {
  const segment = new URL(url).pathname.split("/").at(-1) ?? "";
  try {
    return decodeURIComponent(segment) || "PDF";
  } catch {
    return segment || "PDF";
  }
};

export async function installPdfDocumentNavigation(cdp: CDPSession) {
  const nativeViewer = await cdp.send("Runtime.evaluate", {
    expression: "navigator.pdfViewerEnabled",
    returnByValue: true,
  });
  if (nativeViewer.result?.value === true) return;
  const { frameTree } = await cdp.send("Page.getFrameTree");
  // The shell cannot open PDFs. Commit a document at the original URL so the
  // client can embed signed asset bytes, or say why any other PDF cannot show,
  // while Back and Forward keep working.
  cdp.on("Fetch.requestPaused", (event) => {
    const { requestId, request, frameId } = event;
    const proceed = () => cdp.send("Fetch.continueRequest", { requestId });
    void (async () => {
      const status = event.responseStatusCode;
      if (
        request.method !== "GET" ||
        frameId !== frameTree.frame.id ||
        status === undefined ||
        (status >= 300 && status < 400)
      ) {
        await proceed();
        return;
      }
      const header = (name: string) =>
        event.responseHeaders
          ?.find((entry) => entry.name.toLowerCase() === name)
          ?.value.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
      const isPdf = status >= 200 && status < 300 && header("content-type") === "application/pdf";
      const asset = isPdfAssetUrl(request.url);
      if (!asset && (!isPdf || header("content-disposition") === "attachment")) {
        await proceed();
        return;
      }
      if (!isPdf) {
        // Reach the browser's requestfailed path instead of committing a successful PDF tab.
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" });
        return;
      }
      const name = escapeHtml(fileName(request.url));
      const message = asset
        ? "This PDF is displayed in the connected client."
        : `This PDF cannot be displayed because this browser has no PDF viewer. Fetch ${escapeHtml(request.url)} directly to read it.`;
      await cdp.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/html; charset=utf-8" },
          { name: "Cache-Control", value: "no-store" },
          { name: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
          { name: "X-Content-Type-Options", value: "nosniff" },
        ],
        body: Buffer.from(
          `<!doctype html><html><head><title>${name}</title></head><body><h1>${name}</h1><p>${message}</p></body></html>`,
        ).toString("base64"),
      });
    })().catch(() => proceed().catch(constVoid));
  });
  // Any site can serve a PDF, with or without a .pdf path, so every document
  // response pauses; subresources such as the client's PDF fetch never do.
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }],
  });
}
