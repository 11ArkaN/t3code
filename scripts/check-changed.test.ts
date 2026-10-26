// @effect-diagnostics nodeBuiltinImport:off - Exercises the check runner in an isolated Git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it("propagates a knip failure after a workspace-only change", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "check-changed-"));
  const write = (file: string, content: string) => {
    const path = NodePath.join(root, file);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, content);
  };
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    write(
      "package.json",
      JSON.stringify({
        type: "module",
        scripts: { "knip:check": "knip --include files,dependencies" },
      }),
    );
    write("pnpm-workspace.yaml", "packages: []\n");
    write(".gitignore", "node_modules/\nbin/\n");
    for (const file of ["scripts/check-changed.ts", ".github/scripts/ci-changes.cjs"]) {
      write(file, NodeFS.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    }
    git("init");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "fixture",
    );
    NodeFS.appendFileSync(
      NodePath.join(root, "pnpm-workspace.yaml"),
      "catalog:\n  unused: 1.0.0\n",
    );
    write(
      "bin/vp",
      `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.includes('knip') || args.includes('knip:check')) { console.error('unused dependency fixture'); process.exitCode = 1; }\n`,
    );
    NodeFS.chmodSync(NodePath.join(root, "bin/vp"), 0o755);
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/check-changed.ts", "HEAD"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          PATH: `${NodePath.join(root, "bin")}${NodePath.delimiter}${process.env.PATH}`,
        },
      },
    );
    expect(result.stdout + result.stderr).toContain("unused dependency fixture");
    expect(result.status).toBe(1);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
