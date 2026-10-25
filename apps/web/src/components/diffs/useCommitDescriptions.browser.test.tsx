import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render, type Screen } from "../../../test/render";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), branchCommits: vi.fn() }));

vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: null }));
vi.mock("@t3tools/client-runtime/state/review", async () => {
  const { Atom } = await import("effect/reactivity");
  const permission = Atom.make(true).pipe(Atom.keepAlive);
  return {
    createReviewEnvironmentAtoms: () => ({
      commitDescriptions: { permissionAtom: () => permission },
      branchCommits: mocks.branchCommits,
    }),
  };
});
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => mocks.generate }));

import { reviewEnvironment } from "~/state/review";

import { useCommitDescriptionWarmup } from "./useCommitDescriptionWarmup";
import { useCommitDescriptions, useCommitMenuSnapshot } from "./useCommitDescriptions";

const shas = Array.from({ length: 25 }, (_, index) => `sha${index}`);
const defaults = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  cwd: "/repo",
  modelKey: JSON.stringify({ instanceId: "codex", model: "model-a" }),
  shas,
  enabled: true,
  visible: true,
  open: false,
};

function Probe({ paginate = false, ...props }: Partial<typeof defaults> & { paginate?: boolean }) {
  const [open, setOpen] = useState(false);
  const { descriptions, lastIndex, observeLast, retry } = useCommitDescriptions({
    ...defaults,
    open,
    ...props,
  });
  return (
    <>
      <button
        onClick={() => {
          if (!open) retry();
          setOpen(!open);
        }}
      >
        {open ? "Close menu" : "Open menu"}
      </button>
      {paginate && open ? (
        <div aria-label="Commit rows" style={{ height: 100, overflowY: "auto" }}>
          {shas.map((sha, index) => (
            <div
              key={sha}
              ref={index === lastIndex ? observeLast : undefined}
              style={{ height: 24 }}
            >
              {sha}
            </div>
          ))}
        </div>
      ) : null}
      <output aria-label="Summary count">{descriptions.size}</output>
      <ul aria-label="Summaries">
        {[...descriptions].map(([sha, description]) => (
          <li key={sha}>{description}</li>
        ))}
      </ul>
    </>
  );
}

function Warmup(props: Partial<Parameters<typeof useCommitDescriptionWarmup>[0]>) {
  useCommitDescriptionWarmup({
    ...defaults,
    baseRef: null,
    mutationId: null,
    ...props,
  });
  return null;
}

function CommitListProbe({
  commits,
  open,
  scope = "repo",
}: {
  commits: ReadonlyArray<string> | null;
  open: boolean;
  scope?: string;
}) {
  const snapshot = useCommitMenuSnapshot(commits, open, scope);
  return <output aria-label="Commits">{snapshot?.join(", ")}</output>;
}

function clickMenuButton(screen: Screen, name: string) {
  return act(() =>
    screen
      .getByRole("button", { name })
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
}

function setup() {
  const registry = AtomRegistry.make();
  mocks.generate.mockReset();
  const commits = Atom.make(AsyncResult.success({ commits: shas.map((sha) => ({ sha })) })).pipe(
    Atom.keepAlive,
  );
  mocks.branchCommits
    .mockReset()
    .mockReturnValue(Atom.make((get) => get(commits)).pipe(Atom.keepAlive));
  type Result = AtomCommandResult<
    { modelSelection: unknown; descriptions: Array<{ sha: string; description: string }> },
    Error
  >;
  const requests: Array<{ shas: string[]; resolve: (result: Result) => void }> = [];
  mocks.generate.mockImplementation(
    ({ input }: { input: { shas: string[] } }) =>
      new Promise<Result>((resolve) => {
        requests.push({ shas: input.shas, resolve });
      }),
  );
  return {
    [Symbol.dispose]: () => registry.dispose(),
    setCommits: (next: string[]) =>
      registry.set(commits, AsyncResult.success({ commits: next.map((sha) => ({ sha })) })),
    wrap: (children: ReactNode) => (
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    ),
    setAllowed: (allowed: boolean) =>
      registry.set(
        reviewEnvironment.commitDescriptions.permissionAtom(
          defaults.environmentId,
        ) as Atom.Writable<boolean>,
        allowed,
      ),
    async fail(index: number) {
      await act(() =>
        requests[index]!.resolve(AsyncResult.failure(Cause.fail(new Error("Failed")))),
      );
    },
    async complete(index: number, description = "Prepared summary", modelKey = defaults.modelKey) {
      const request = requests[index]!;
      await act(() =>
        request.resolve(
          AsyncResult.success({
            modelSelection: JSON.parse(modelKey),
            descriptions: request.shas.map((sha) => ({ sha, description })),
          }),
        ),
      );
    },
  };
}

it("prepares the first ten summaries before the menu opens and reuses them on reopening", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  expect(mocks.generate).toHaveBeenCalledExactlyOnceWith({
    environmentId: defaults.environmentId,
    input: { cwd: "/repo", threadId: defaults.threadId, shas: shas.slice(0, 10) },
  });
  await test.complete(0);
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await screen.rerender(test.wrap(<Probe open={false} />));
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("keeps summaries fixed while the menu is open and shows completed work on the next open", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe open />));
  await test.complete(0);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await screen.rerender(test.wrap(<Probe open={false} />));
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("prepares only the next ten after scrolling and keeps the open summaries fixed", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe paginate />));
  await test.complete(0);
  await clickMenuButton(screen, "Open menu");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  screen.getByLabelText("Commit rows").element().scrollTop = 216;
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
  expect(mocks.generate.mock.calls[1]![0].input.shas).toEqual(shas.slice(10, 20));
  await test.complete(1);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await clickMenuButton(screen, "Close menu");
  await clickMenuButton(screen, "Open menu");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("20");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it("keeps cached commits fixed during an open-menu refresh and shows the new list on reopening", async () => {
  using test = setup();
  await using screen = await render(
    test.wrap(<CommitListProbe commits={["Old commit"]} open={false} />),
  );
  await screen.rerender(test.wrap(<CommitListProbe commits={["Old commit"]} open />));
  await screen.rerender(test.wrap(<CommitListProbe commits={["New commit"]} open />));
  await expect.element(screen.getByLabelText("Commits")).toHaveTextContent("Old commit");
  await screen.rerender(test.wrap(<CommitListProbe commits={["New commit"]} open={false} />));
  await screen.rerender(test.wrap(<CommitListProbe commits={["New commit"]} open />));
  await expect.element(screen.getByLabelText("Commits")).toHaveTextContent("New commit");
});

it("shows the first cold commit list while open and clears the old list on a scope change", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<CommitListProbe commits={null} open />));
  await screen.rerender(test.wrap(<CommitListProbe commits={["First commit"]} open />));
  await expect.element(screen.getByLabelText("Commits")).toHaveTextContent("First commit");
  await screen.rerender(test.wrap(<CommitListProbe commits={null} open scope="other-repo" />));
  await expect.element(screen.getByLabelText("Commits")).toBeEmptyDOMElement();
  await screen.rerender(
    test.wrap(<CommitListProbe commits={["Other commit"]} open scope="other-repo" />),
  );
  await expect.element(screen.getByLabelText("Commits")).toHaveTextContent("Other commit");
});

it("starts no generation while hidden and retains loaded summaries across hiding", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe visible={false} />));
  expect(mocks.generate).not.toHaveBeenCalled();
  await screen.rerender(test.wrap(<Probe />));
  await test.complete(0);
  await screen.rerender(test.wrap(<Probe visible={false} shas={[]} />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("retries a failed batch only on menu reopening and preserves successful summaries", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  await test.complete(0);
  const changed = ["new-sha", "other-new-sha", ...shas];
  await screen.rerender(test.wrap(<Probe shas={changed} />));
  await clickMenuButton(screen, "Open menu");
  await test.fail(1);
  await screen.rerender(test.wrap(<Probe shas={changed} />));
  await screen.rerender(test.wrap(<Probe visible={false} shas={changed} />));
  await screen.rerender(test.wrap(<Probe shas={changed} />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  await clickMenuButton(screen, "Close menu");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  await clickMenuButton(screen, "Open menu");
  expect(mocks.generate).toHaveBeenCalledTimes(3);
  expect(mocks.generate.mock.calls[2]![0].input.shas).toEqual(["new-sha", "other-new-sha"]);
  await clickMenuButton(screen, "Close menu");
  await clickMenuButton(screen, "Open menu");
  expect(mocks.generate).toHaveBeenCalledTimes(3);
  await test.complete(2, "Retried summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await clickMenuButton(screen, "Close menu");
  await clickMenuButton(screen, "Open menu");
  await expect.element(screen.getByText("Retried summary").first()).toBeVisible();
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("12");
  await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("Prepared summary");
  expect(mocks.generate).toHaveBeenCalledTimes(3);
});

it("serializes changed commit lists and waits until the panel is visible to fetch missing summaries", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe open />));
  const changed = ["new-sha", ...shas];
  await screen.rerender(test.wrap(<Probe open shas={changed} />));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await screen.rerender(test.wrap(<Probe visible={false} shas={changed} />));
  await test.complete(0);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await screen.rerender(test.wrap(<Probe open shas={changed} />));
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  expect(mocks.generate.mock.calls[1]![0].input.shas).toEqual(["new-sha"]);
  await test.complete(1, "New commit summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await screen.rerender(test.wrap(<Probe shas={changed} />));
  await screen.rerender(test.wrap(<Probe open shas={changed} />));
  await expect.element(screen.getByText("New commit summary")).toBeVisible();
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("11");
});

it.each([
  { modelKey: JSON.stringify({ instanceId: "codex", model: "model-b" }) },
  {
    modelKey: JSON.stringify({
      instanceId: "codex",
      model: "model-a",
      options: [{ id: "effort", value: "max" }],
    }),
  },
  { environmentId: EnvironmentId.make("other-environment") },
  { threadId: ThreadId.make("other-thread") },
  { cwd: "/other-repo" },
])("drops old summaries when the scope changes: %j", async (change) => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  await screen.rerender(test.wrap(<Probe {...change} />));
  await test.complete(0, "Old summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await test.complete(1, "New summary", "modelKey" in change ? change.modelKey : defaults.modelKey);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("New summary");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it.each([
  { modelKey: JSON.stringify({ instanceId: "codex", model: "model-b" }) },
  {
    modelKey: JSON.stringify({
      instanceId: "codex",
      model: "model-a",
      options: [{ id: "effort", value: "max" }],
    }),
  },
  { threadId: ThreadId.make("other-thread") },
  { cwd: "/other-repo" },
  { environmentId: EnvironmentId.make("other-environment") },
])("rejects late results after switching away and back to the same scope: %j", async (change) => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  await screen.rerender(test.wrap(<Probe {...change} />));
  await screen.rerender(test.wrap(<Probe />));
  await test.complete(0, "Old summary");
  await test.complete(1, "Other model summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await test.complete(2, "Current summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("Current summary");
});

it("waits for readiness and drops cached and late summaries when the grant is revoked", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe enabled={false} />));
  expect(mocks.generate).not.toHaveBeenCalled();
  await screen.rerender(test.wrap(<Probe />));
  await test.complete(0);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await screen.rerender(test.wrap(<Probe open />));
  test.setAllowed(false);
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  test.setAllowed(true);
  await screen.rerender(test.wrap(<Probe />));
  test.setAllowed(false);
  await screen.rerender(test.wrap(<Probe />));
  await test.complete(1, "Revoked summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  test.setAllowed(true);
  await screen.rerender(test.wrap(<Probe />));
  await test.complete(2);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(3);
});

it("shares pending preparation and completed summaries before the first panel mount and across remounts", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Warmup />));
  await screen.rerender(
    test.wrap(
      <>
        <Warmup />
        <Probe />
      </>,
    ),
  );
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await screen.rerender(test.wrap(<Probe key="remounted" />));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await test.complete(0);
  await screen.rerender(test.wrap(<Probe key="panel" open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("keeps failed preparation across remounts until an explicit menu reopen", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  await test.fail(0);
  await screen.rerender(test.wrap(<Probe key="panel" />));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await clickMenuButton(screen, "Open menu");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it("rejects a response for a different full model selection without an automatic retry", async () => {
  using test = setup();
  const modelKey = JSON.stringify({
    instanceId: "codex",
    model: "model-a",
    options: [{ id: "effort", value: "max" }],
  });
  await using screen = await render(test.wrap(<Probe modelKey={modelKey} />));
  await test.complete(0);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await screen.rerender(test.wrap(<Probe key="panel" modelKey={modelKey} />));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await clickMenuButton(screen, "Open menu");
  await test.complete(1, "Exact model", modelKey);
  await clickMenuButton(screen, "Close menu");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
});

it("checks the current grant before publishing even before React handles revocation", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  test.setAllowed(false);
  await test.complete(0, "Revoked");
  test.setAllowed(true);
  await screen.rerender(test.wrap(<Probe key="panel" />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
});

it("prepares only missing first-ten commits when workspace events update the branch query", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Warmup baseRef="origin/main" />));
  expect(mocks.branchCommits).toHaveBeenCalledWith({
    environmentId: defaults.environmentId,
    input: { cwd: defaults.cwd, baseRef: "origin/main" },
  });
  expect(mocks.generate.mock.calls[0]![0].input.shas).toEqual(shas.slice(0, 10));
  await test.complete(0);
  await act(() => test.setCommits(["new-sha", ...shas]));
  await screen.rerender(test.wrap(<Warmup baseRef="origin/main" mutationId="workspace-change" />));
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  expect(mocks.generate.mock.calls[1]![0].input.shas).toEqual(["new-sha"]);
  await test.complete(1);
  await screen.rerender(test.wrap(<Probe shas={["new-sha", ...shas]} open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("11");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it("does not read commits or generate while warmup is not ready or either grant is missing", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Warmup enabled={false} />));
  await screen.rerender(test.wrap(<Warmup threadId={null} />));
  await screen.rerender(test.wrap(<Warmup environmentId={null} />));
  await screen.rerender(test.wrap(<Warmup cwd={undefined} />));
  test.setAllowed(false);
  await screen.rerender(test.wrap(<Warmup />));
  expect(mocks.branchCommits).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  test.setAllowed(true);
  await screen.rerender(test.wrap(<Warmup />));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("rejects pending results after a grant is revoked and restored before React renders", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Probe />));
  test.setAllowed(false);
  test.setAllowed(true);
  await test.complete(0, "Old grant");
  await screen.rerender(test.wrap(<Probe />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  await test.complete(1, "New grant");
  await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("New grant");
});

it("accepts the exact selected options when the response puts them in a different order", async () => {
  using test = setup();
  const selection = {
    instanceId: "codex",
    model: "model-a",
    options: [
      { id: "effort", value: "max" },
      { id: "fastMode", value: true },
    ],
  };
  await using screen = await render(test.wrap(<Probe modelKey={JSON.stringify(selection)} />));
  await test.complete(
    0,
    "Full options",
    JSON.stringify({ ...selection, options: selection.options.toReversed() }),
  );
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
});

it("shows finished warmup immediately on the first panel mount", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Warmup />));
  await test.complete(0);
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("rejects old preparation after the active chat remounts into another scope and back", async () => {
  using test = setup();
  await using screen = await render(test.wrap(<Warmup />));
  await screen.rerender(test.wrap(<Warmup key="other" threadId={ThreadId.make("other-thread")} />));
  await screen.rerender(test.wrap(<Warmup key="returned" />));
  expect(mocks.generate).toHaveBeenCalledTimes(3);
  await test.complete(0, "Old preparation");
  await test.complete(1, "Other thread");
  await screen.rerender(test.wrap(<Probe open />));
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await test.complete(2, "Current preparation");
  await screen.rerender(test.wrap(<Probe open={false} />));
  await expect
    .element(screen.getByRole("listitem").first())
    .toHaveTextContent("Current preparation");
});

it.each([
  { change: { enabled: false }, requests: 1 },
  { change: { threadId: ThreadId.make("other-thread") }, requests: 2 },
])(
  "keeps the original shared request when one consumer changes: %j",
  async ({ change, requests }) => {
    using test = setup();
    await using screen = await render(
      test.wrap(
        <>
          <Probe />
          <Probe />
        </>,
      ),
    );
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await screen.rerender(
      test.wrap(
        <>
          <Probe {...change} />
          <Probe />
        </>,
      ),
    );
    expect(mocks.generate).toHaveBeenCalledTimes(requests);
    await test.complete(0);
    await expect.element(screen.getByLabelText("Summary count").last()).toHaveTextContent("10");
    expect(mocks.generate).toHaveBeenCalledTimes(requests);
  },
);
