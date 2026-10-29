import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: null }));
vi.mock("@t3tools/client-runtime/state/review", async () => {
  const { Atom } = await import("effect/reactivity");
  const permission = Atom.make(true).pipe(Atom.keepAlive);
  return {
    createReviewEnvironmentAtoms: () => ({
      commitDescriptions: { permissionAtom: () => permission },
    }),
  };
});
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => mocks.generate }));

import { useCommitDescriptions } from "./useCommitDescriptions";

const shas = Array.from({ length: 25 }, (_, index) => `sha${index}`);
const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");

function LateCommitMenu() {
  const [commits, setCommits] = useState<string[]>([]);
  const { descriptions, loadFirst, observeRow } = useCommitDescriptions({
    environmentId,
    threadId,
    cwd: "/repo",
    modelKey: JSON.stringify({ instanceId: "codex", model: "model-a" }),
    shas: commits,
  });
  return (
    <>
      <button onClick={loadFirst}>Open menu</button>
      <button onClick={() => setCommits(shas)}>Receive commits</button>
      <div style={{ height: 80, overflow: "auto" }}>
        {commits.map((sha, index) => (
          <div key={sha} ref={observeRow(index)} style={{ height: 40 }}>
            {descriptions.get(sha) ?? sha}
          </div>
        ))}
      </div>
    </>
  );
}

function setup() {
  const registry = AtomRegistry.make();
  return { registry, [Symbol.dispose]: () => registry.dispose() };
}

it("shows descriptions for the first ten commits, even when they arrive after the menu opens", async () => {
  using test = setup();
  mocks.generate.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { descriptions: [{ sha: shas[0], description: "First commit summary" }] },
  });
  await using screen = await render(
    <RegistryContext.Provider value={test.registry}>
      <LateCommitMenu />
    </RegistryContext.Provider>,
  );
  await screen.getByRole("button", { name: "Open menu" }).click();
  expect(mocks.generate).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Receive commits" }).click();
  await expect.element(screen.getByText("First commit summary")).toBeVisible();
  expect(mocks.generate).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { cwd: "/repo", threadId, shas: shas.slice(0, 10) },
  });
});
