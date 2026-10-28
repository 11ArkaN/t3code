import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { findOwnedLauncher, findRecordedLaunchers } from "./uninstall.ts";

it.layer(NodeServices.layer)("t3 uninstall launcher", (it) => {
  it.effect("claims only a launcher that points into this home's runtime tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-uninstall-" });
      const versionsDir = path.join(root, "runtime/versions");
      const exe = path.join(versionsDir, "1.0.0/t3");
      const otherExe = path.join(root, "other/runtime/versions/1.0.0/t3");
      const copy = path.join(root, "copy/t3");
      for (const file of [exe, otherExe, copy]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      const ours = path.join(root, "bin/t3");
      const theirs = path.join(root, "other/bin/t3");
      yield* fs.makeDirectory(path.dirname(ours), { recursive: true });
      yield* fs.makeDirectory(path.dirname(theirs), { recursive: true });
      yield* fs.symlink(exe, ours);
      yield* fs.symlink(otherExe, theirs);

      assert.equal(yield* findOwnedLauncher({ launchedAs: ours, versionsDir }), ours);
      assert.isUndefined(yield* findOwnedLauncher({ launchedAs: theirs, versionsDir }));
      assert.isUndefined(yield* findOwnedLauncher({ launchedAs: copy, versionsDir }));
      assert.isUndefined(yield* findOwnedLauncher({ launchedAs: undefined, versionsDir }));
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("also finds recorded launchers that npx did not start from", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // macOS spells the temp folder /var but resolves it to /private/var.
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-uninstall-" })
        .pipe(Effect.flatMap(fs.realPath));
      const home = path.join(root, ".t3");
      const versionsDir = path.join(home, "runtime/versions");
      const exe = path.join(versionsDir, "1.0.0/t3");
      yield* fs.makeDirectory(path.dirname(exe), { recursive: true });
      yield* fs.writeFileString(exe, "");
      yield* fs.makeDirectory(path.join(root, "bin"));
      const ours = path.join(root, "bin/t3");
      const throughAlias = path.join(root, "bin/t3-alias");
      const pruned = path.join(root, "bin/t3-pruned");
      const foreign = path.join(root, "bin/t3-foreign");
      yield* fs.symlink(path.join(root, ".t3"), path.join(root, "alias"));
      yield* fs.symlink(exe, ours);
      yield* fs.symlink(path.join(root, "alias/runtime/versions/1.0.0/t3"), throughAlias);
      yield* fs.symlink(path.join(versionsDir, "0.9.0/t3"), pruned);
      yield* fs.writeFileString(foreign, "#!/bin/sh\n");
      yield* fs.writeFileString(
        path.join(home, "runtime/launchers"),
        [ours, throughAlias, pruned, foreign, path.join(root, "missing")].join("\n") + "\n",
      );

      // Read through the alias too: the T3 home itself can be a symlink.
      assert.deepStrictEqual(yield* findRecordedLaunchers(versionsDir), [
        ours,
        throughAlias,
        pruned,
      ]);
      assert.deepStrictEqual(
        yield* findRecordedLaunchers(path.join(root, "alias/runtime/versions")),
        [ours, throughAlias, pruned],
      );
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );
});
