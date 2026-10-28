import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { AssetResource } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({
  Passthrough: ({ children }: { children?: unknown }) => children,
  markdownProps: null as null | Record<string, unknown>,
  authorize: (resource: AssetResource | null) =>
    resource && "url" in resource
      ? `https://env.test/api/assets/signed?url=${encodeURIComponent(resource.url)}`
      : null,
}));

vi.mock("react-native", () => ({ Pressable: harness.Passthrough, View: harness.Passthrough }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/FilePreviewModal", () => ({ FilePreviewModal: () => null }));
vi.mock("../../components/MediaVideoPlayer", () => ({ MediaVideoPlayer: () => null }));
vi.mock("../../components/VideoAttachmentTile", () => ({ VideoAttachmentTile: () => null }));
vi.mock("../../components/VideoPreviewModal", () => ({ VideoPreviewModal: () => null }));
vi.mock("../threads/ThreadMarkdownImage", () => ({ ThreadMarkdownImageView: () => null }));
vi.mock("../files/FileMarkdownPreview", () => ({
  useMarkdownPreviewStyles: () => ({ nativeTextStyle: {} }),
}));
vi.mock("../../native/useOpenPullRequest", () => ({ useOpenPullRequest: () => async () => {} }));
vi.mock("../../native/SelectableMarkdownText", () => ({
  SelectableMarkdownText: (props: Record<string, unknown>) => {
    harness.markdownProps = props;
    return null;
  },
}));
vi.mock("../../state/entities", () => ({ useProject: () => null }));
vi.mock("./usePullRequestDiff", () => ({ pullRequestTarget: () => null }));
vi.mock("../../state/assets", () => ({
  useAssetUrlState: (_environmentId: unknown, resource: AssetResource | null) => {
    const url = harness.authorize(resource);
    return url ? { _tag: "Success", url } : { _tag: "Loading" };
  },
  useAssetUrl: (_environmentId: unknown, resource: AssetResource | null) =>
    harness.authorize(resource),
  useRefreshAssetUrl: (_environmentId: unknown, resource: AssetResource | null) => async () =>
    harness.authorize(resource),
  refreshAssetUrl: async (_environmentId: unknown, resource: AssetResource) =>
    harness.authorize(resource),
}));

import { EnvironmentId, SOURCE_CONTROL_MEDIA_ASSET } from "@t3tools/contracts";
import type { MarkdownImageSourceResolver } from "../../native/SelectableMarkdownText.types";
import { PullRequestMediaContext } from "./PullRequestMedia";
import { PullRequestMarkdown } from "./PullRequestMarkdown";

it("loads an image that shares a paragraph with its caption through the authorized asset URL", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const href = "https://github.com/acme/private-repo/raw/main/a.png";
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        <PullRequestMediaContext value={{ environmentId: EnvironmentId.make("env"), cwd: "/repo" }}>
          <PullRequestMarkdown markdown={`<sub>Caption, newline only</sub>\n![](${href})`} />
        </PullRequestMediaContext>,
      ),
    );
    // Enriched offers `renderImage` only for an image alone in its paragraph; this one loads natively.
    const resolve = harness.markdownProps?.resolveImageSource as
      | MarkdownImageSourceResolver
      | undefined;
    const source = await resolve?.({ href, alt: null, title: null });
    expect(source, "inline PR image source").toEqual({
      uri: harness.authorize({
        _tag: SOURCE_CONTROL_MEDIA_ASSET,
        cwd: "/repo",
        url: "https://raw.githubusercontent.com/acme/private-repo/main/a.png",
      }),
    });
  } finally {
    await act(async () => root.unmount());
  }
});
