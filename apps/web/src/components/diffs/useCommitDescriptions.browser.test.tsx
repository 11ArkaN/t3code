import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ allowed: true, generate: vi.fn() }));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.allowed }));
vi.mock("~/state/review", () => ({
  reviewEnvironment: { commitDescriptions: { permissionAtom: () => null } },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => mocks.generate }));

import { useCommitDescriptions } from "./useCommitDescriptions";

const shas = Array.from({ length: 25 }, (_, index) => `sha${index}`);
const defaults = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  cwd: "/repo",
  modelKey: "model-a",
  shas,
  enabled: true,
  visible: true,
  open: false,
};

function Probe(props: Partial<typeof defaults>) {
  const { descriptions } = useCommitDescriptions({ ...defaults, ...props });
  return (
    <>
      <output aria-label="Summary count">{descriptions.size}</output>
      <ul aria-label="Summaries">
        {[...descriptions].map(([sha, description]) => (
          <li key={sha}>{description}</li>
        ))}
      </ul>
    </>
  );
}

function setup() {
  mocks.allowed = true;
  mocks.generate.mockReset();
  type Result = {
    _tag: "Success";
    value: { descriptions: Array<{ sha: string; description: string }> };
  };
  const requests: Array<{ shas: string[]; resolve: (result: Result) => void }> = [];
  mocks.generate.mockImplementation(
    ({ input }: { input: { shas: string[] } }) =>
      new Promise<Result>((resolve) => {
        requests.push({ shas: input.shas, resolve });
      }),
  );
  return {
    async complete(index: number, description = "Prepared summary") {
      const request = requests[index]!;
      await act(() =>
        request.resolve({
          _tag: "Success",
          value: { descriptions: request.shas.map((sha) => ({ sha, description })) },
        }),
      );
    },
  };
}

it("prepares the first ten summaries before the menu opens and reuses them on reopening", async () => {
  const test = setup();
  await using screen = await render(<Probe />);
  expect(mocks.generate).toHaveBeenCalledExactlyOnceWith({
    environmentId: defaults.environmentId,
    input: { cwd: "/repo", threadId: defaults.threadId, shas: shas.slice(0, 10) },
  });
  await test.complete(0);
  await screen.rerender(<Probe open />);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await screen.rerender(<Probe open={false} />);
  await screen.rerender(<Probe open />);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("starts no generation while hidden and retains loaded summaries across hiding", async () => {
  const test = setup();
  await using screen = await render(<Probe visible={false} />);
  expect(mocks.generate).not.toHaveBeenCalled();
  await screen.rerender(<Probe />);
  await test.complete(0);
  await screen.rerender(<Probe visible={false} shas={[]} />);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await screen.rerender(<Probe open />);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});

it("serializes changed commit lists and waits until the panel is visible to fetch missing summaries", async () => {
  const test = setup();
  await using screen = await render(<Probe open />);
  const changed = ["new-sha", ...shas];
  await screen.rerender(<Probe open shas={changed} />);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await screen.rerender(<Probe visible={false} shas={changed} />);
  await test.complete(0);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await screen.rerender(<Probe open shas={changed} />);
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  expect(mocks.generate.mock.calls[1]![0].input.shas).toEqual(["new-sha"]);
  await test.complete(1, "New commit summary");
  await expect.element(screen.getByText("New commit summary")).toBeVisible();
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("11");
});

it.each([
  { modelKey: "model-b" },
  {
    modelKey: JSON.stringify({
      instanceId: "codex",
      model: "model-a",
      options: { effort: "max" },
    }),
  },
  { environmentId: EnvironmentId.make("other-environment") },
  { threadId: ThreadId.make("other-thread") },
  { cwd: "/other-repo" },
])("drops old summaries when the scope changes: %j", async (change) => {
  const test = setup();
  await using screen = await render(<Probe />);
  await screen.rerender(<Probe {...change} />);
  await test.complete(0, "Old summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await test.complete(1, "New summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("New summary");
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});

it("rejects late results after switching away and back to the same model", async () => {
  const test = setup();
  await using screen = await render(<Probe />);
  await screen.rerender(<Probe modelKey="model-b" />);
  await screen.rerender(<Probe />);
  await test.complete(0, "Old summary");
  await test.complete(1, "Other model summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  await test.complete(2, "Current summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  await expect.element(screen.getByRole("listitem").first()).toHaveTextContent("Current summary");
});

it("waits for readiness and drops cached and late summaries when the grant is revoked", async () => {
  const test = setup();
  await using screen = await render(<Probe enabled={false} />);
  expect(mocks.generate).not.toHaveBeenCalled();
  await screen.rerender(<Probe />);
  await test.complete(0);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  mocks.allowed = false;
  await screen.rerender(<Probe />);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  mocks.allowed = true;
  await screen.rerender(<Probe />);
  mocks.allowed = false;
  await screen.rerender(<Probe />);
  await test.complete(1, "Revoked summary");
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("0");
  mocks.allowed = true;
  await screen.rerender(<Probe />);
  await test.complete(2);
  await expect.element(screen.getByLabelText("Summary count")).toHaveTextContent("10");
  expect(mocks.generate).toHaveBeenCalledTimes(3);
});
