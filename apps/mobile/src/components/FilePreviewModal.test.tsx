import { EnvironmentId, SOURCE_CONTROL_MEDIA_ASSET, type AssetResource } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import type { FilePreviewItem, ResolvedFilePreviewSource } from "./FilePreviewModal.types";

const harness = vi.hoisted(() => ({
  refresh: vi.fn<(environmentId: string, resource: { url: string }) => Promise<string | null>>(),
  present: (_source: ResolvedFilePreviewSource) => {},
}));

vi.mock("../state/assets", () => ({
  refreshAssetUrl: (environmentId: string, resource: { url: string }) =>
    harness.refresh(environmentId, resource),
}));
vi.mock("./FilePreview", () => ({
  FilePreview: (props: { source: ResolvedFilePreviewSource }) => {
    harness.present(props.source);
    return null;
  },
}));
vi.mock("./ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../lib/previewPresentation", () => ({ usePreviewPresentation: () => {} }));
vi.mock("../lib/localAttachmentPreview", () => ({ loadLocalAttachmentPreview: vi.fn() }));
vi.mock("../lib/attachmentDownload", () => ({
  downloadAndShareAttachment: vi.fn(),
  nativeViewerErrorMessage: () => "",
  shareLocalAttachment: vi.fn(),
}));

import { FilePreviewModal } from "./FilePreviewModal";

const environmentId = EnvironmentId.make("environment-1");
const image = (name: string): FilePreviewItem => ({
  kind: "image",
  environmentId,
  resource: {
    _tag: SOURCE_CONTROL_MEDIA_ASSET,
    cwd: "/repo",
    url: `https://github.com/user-attachments/assets/${name}`,
  } satisfies AssetResource,
});

async function openGallery(broken: string) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const outcome = Promise.withResolvers<{ presented: readonly string[] } | "closed">();
  harness.present = (source) =>
    outcome.resolve({ presented: [source.uri, ...(source.gallery ?? []).map((item) => item.uri)] });
  harness.refresh.mockImplementation(async (_environmentId, resource) => {
    if (resource.url.endsWith(`/${broken}`)) throw new Error("asset was deleted");
    return `${resource.url}?signed`;
  });
  const tapped = image("tapped");
  const gallery = [image("first"), tapped, image("sibling"), image("last")];
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        <FilePreviewModal
          source={{ ...tapped, gallery }}
          onRequestClose={() => outcome.resolve("closed")}
        />,
      ),
    );
    return await outcome.promise;
  } finally {
    await act(async () => root.unmount());
  }
}

it("opens the tapped image when a sibling in its gallery fails to resolve", async () => {
  expect(await openGallery("sibling")).toEqual({
    presented: [
      "https://github.com/user-attachments/assets/tapped?signed",
      "https://github.com/user-attachments/assets/first?signed",
      "https://github.com/user-attachments/assets/tapped?signed",
      "https://github.com/user-attachments/assets/last?signed",
    ],
  });
});

it("closes the preview when the tapped image fails to resolve", async () => {
  expect(await openGallery("tapped")).toBe("closed");
});
