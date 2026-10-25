import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ChangedFilesCard } from "./ChangedFilesTree";

describe("ChangedFilesCard", () => {
  it("expands a collapsed directory to show its files", async () => {
    await using screen = await render(
      <ChangedFilesCard
        runId={RunId.make("run-1")}
        files={[
          { path: "src/a.ts", kind: "modified", additions: 1, deletions: 0 },
          { path: "src/b.ts", kind: "modified", additions: 2, deletions: 1 },
        ]}
        allDirectoriesExpanded={false}
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
      // The card renders no links and reads no route.
      { router: false },
    );

    await expect.element(screen.getByText("a.ts")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /src/ }));
    await expect.element(screen.getByText("a.ts")).toBeVisible();
    await expect.element(screen.getByText("b.ts")).toBeVisible();
  });
});
