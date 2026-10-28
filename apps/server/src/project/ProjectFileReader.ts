import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ProcessRunner from "../processRunner.ts";

/**
 * open() of a file under macOS privacy protection waits on a consent prompt a
 * headless server never gets, and an online-only file waits on its download.
 * Either pins a libuv pool thread that interruption cannot free, so regular
 * files are read by a `cat` child that the runner kills at the deadline.
 */
const READ_DEADLINE = "2 seconds";
const MAX_READ_BYTES = 1024 * 1024;
// A blocked path is skipped for a while, then read again in case it was fixed.
const BLOCKED_PATH_RETRY_MS = 5 * 60 * 1000;
const MAX_BLOCKED_PATHS = 1024;

export class ProjectFileReader extends Context.Service<
  ProjectFileReader,
  {
    /**
     * Reads a project-controlled file without risking the libuv pool. Undefined when it is
     * missing, not a regular file, unreadable, or its open() outlived the deadline.
     */
    readonly readFileString: (filePath: string) => Effect.Effect<string | undefined>;
  }
>()("t3/project/ProjectFileReader") {}

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  // No privacy prompts or FIFOs-as-project-files to block open() there.
  const isWindows = yield* HostProcess.isWindows;
  // Paths whose read outlived the deadline, mapped to when they may be read again, so later
  // turn starts do not each wait the deadline out.
  const blockedPaths = new Map<string, number>();

  const readFileString: ProjectFileReader["Service"]["readFileString"] = Effect.fn(
    "ProjectFileReader.readFileString",
  )(function* (filePath) {
    // stat does not open the file, so it neither blocks nor costs a spawn for missing paths.
    const info = yield* fileSystem.stat(filePath).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "File") return undefined;
    if (isWindows) {
      return yield* fileSystem.readFileString(filePath).pipe(Effect.orElseSucceed(() => undefined));
    }
    const now = yield* Clock.currentTimeMillis;
    if ((blockedPaths.get(filePath) ?? 0) > now) return undefined;
    blockedPaths.delete(filePath);
    const result = yield* processRunner
      .run({
        command: "cat",
        args: ["--", filePath],
        timeout: READ_DEADLINE,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: MAX_READ_BYTES,
        outputMode: "truncate",
      })
      .pipe(Effect.option);
    if (Option.isNone(result)) return undefined;
    if (result.value.timedOut) {
      if (blockedPaths.size >= MAX_BLOCKED_PATHS) {
        blockedPaths.delete(blockedPaths.keys().next().value!);
      }
      blockedPaths.set(filePath, now + BLOCKED_PATH_RETRY_MS);
      yield* Effect.logWarning("project file read timed out; skipping it for a while", {
        path: filePath,
      });
      return undefined;
    }
    return result.value.code === 0 ? result.value.stdout : undefined;
  });

  return ProjectFileReader.of({ readFileString });
});

export const layer = Layer.effect(ProjectFileReader, make).pipe(Layer.provide(ProcessRunner.layer));
