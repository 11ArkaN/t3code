import { processOutput } from "@t3tools/source-control-testing/TestSourceControlHost";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/process";
import { probeSourceControlProvider } from "@t3tools/source-control-core/server/discovery";

import * as AzureDevOpsSourceControlProvider from "./AzureDevOpsSourceControlProvider.ts";

const { parseAuth } = AzureDevOpsSourceControlProvider.discovery;

it.effect("recognizes DevOps extension credentials without an Azure account session", () =>
  Effect.gen(function* () {
    const result = yield* probeSourceControlProvider({
      spec: AzureDevOpsSourceControlProvider.discovery,
      cwd: "/repo",
      process: {
        run: (input) => {
          if (input.args[0] === "--version") {
            return Effect.succeed(processOutput("azure-cli 2.91.0\n"));
          }
          if (input.args.slice(0, 3).join(" ") === "devops project list") {
            return Effect.succeed(processOutput('["project-id"]\n'));
          }
          return Effect.succeed(
            processOutput("", {
              stderr: "ERROR: Please run 'az login' to setup account.\n",
              exitCode: ChildProcessSpawner.ExitCode(1),
            }),
          );
        },
      },
    });
    assert.strictEqual(result.status, "available");
    assert.deepStrictEqual(result.auth, {
      status: "authenticated",
      account: Option.none(),
      host: Option.some("dev.azure.com"),
      detail: Option.none(),
    });
  }),
);

it.each([
  ["a signed-in account with no visible projects", "[]", "", 0, "authenticated"],
  ["missing credentials", "", "Run az devops login to sign in.", 1, "unauthenticated"],
  [
    "an expired PAT",
    "",
    "Access Denied: The Personal Access Token used has expired.",
    1,
    "unauthenticated",
  ],
  ["no organization", "", "--organization must be specified.", 1, "unknown"],
  ["a network failure", "", "Failed to establish a new connection", 1, "unknown"],
  ["malformed output", "not json", "", 0, "unknown"],
  ["an unexpected response", "{}", "", 0, "unknown"],
  ["an empty response", "", "", 0, "unknown"],
] as const)("reports %s", (_name, stdout, stderr, exitCode, status) => {
  assert.strictEqual(
    parseAuth(processOutput(stdout, { stderr, exitCode: ChildProcessSpawner.ExitCode(exitCode) }))
      .status,
    status,
  );
});
