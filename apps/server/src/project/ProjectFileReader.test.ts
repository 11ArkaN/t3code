import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";

import * as ProcessRunner from "../processRunner.ts";
import * as ProjectFileReader from "./ProjectFileReader.ts";

/** Every read outlives the deadline, like an open() waiting on a macOS privacy prompt. */
const makeBlockedReader = () => {
  const reads: Array<string> = [];
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) => {
      reads.push(input.args.at(-1) ?? "");
      return Effect.succeed({
        stdout: "",
        stderr: "",
        code: null,
        timedOut: true,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      });
    },
  });
  const layer = Layer.effect(ProjectFileReader.ProjectFileReader, ProjectFileReader.make).pipe(
    Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
  );
  return { reads, layer };
};

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("ProjectFileReader", () => {
  it.layer(NodeServices.layer)("readFileString", (it) => {
    it.effect("skips a path whose read timed out until the retry window passes", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-file-" });
        const settingsPath = path.join(cwd, "settings.local.json");
        yield* fileSystem.writeFileString(settingsPath, "{}");
        const { reads, layer } = makeBlockedReader();

        yield* Effect.gen(function* () {
          const reader = yield* ProjectFileReader.ProjectFileReader;
          assert.isUndefined(yield* reader.readFileString(settingsPath));
          assert.isUndefined(yield* reader.readFileString(settingsPath));
          assert.deepEqual(reads, [settingsPath]);

          yield* TestClock.adjust("5 minutes");
          assert.isUndefined(yield* reader.readFileString(settingsPath));
          assert.deepEqual(reads, [settingsPath, settingsPath]);
        }).pipe(Effect.provide(layer));
      }),
    );

    it.effect("never spawns a read for a missing path or a directory such as .git", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-file-" });
        yield* fileSystem.makeDirectory(path.join(cwd, ".git"));
        const { reads, layer } = makeBlockedReader();

        yield* Effect.gen(function* () {
          const reader = yield* ProjectFileReader.ProjectFileReader;
          assert.isUndefined(yield* reader.readFileString(path.join(cwd, ".git")));
          assert.isUndefined(yield* reader.readFileString(path.join(cwd, "missing.json")));
        }).pipe(Effect.provide(layer));
        assert.deepEqual(reads, []);
      }),
    );
  });
});
