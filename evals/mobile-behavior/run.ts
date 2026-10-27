#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - owns Metro and writes result files.
/**
 * Drives the T3 Code iOS dev client on one simulator against an isolated server with scripted
 * replies, and grades app behavior from the dev-only probe and server state. See README.md.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient } from "effect/http";

import { CASES, type MobileBehaviorCase } from "./cases.ts";
import { APP_ID, DeviceError, makeDevice, SCHEME } from "./device.ts";
import { freePort, startEnvironment, uuid } from "./environment.ts";
import { caseResult, checkFails, summarize, type CaseResult, type SampleRow } from "./grade.ts";
import { SCENARIOS, type Pose, type ScenarioContext } from "./scenarios.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
const POSES = ["phone", "duo-closed", "duo-open", "ipad"] as const satisfies ReadonlyArray<Pose>;

/** This machine's address as the simulator sees it: the tailnet address, else the first LAN IPv4. */
function reachableHost(): string {
  const tailnet = NodeChildProcess.spawnSync("tailscale", ["ip", "-4"], { encoding: "utf8" });
  const ip = tailnet.status === 0 ? tailnet.stdout.trim().split("\n")[0] : undefined;
  if (ip) return ip;
  const lan = Object.values(NodeOS.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === "IPv4" && !entry.internal);
  return lan?.address ?? "127.0.0.1";
}

/** Metro with the behavior probe compiled in, stopped with its process group when the scope ends. */
const startMetro = Effect.fn("run.startMetro")(function* (host: string, out: string) {
  const port = yield* freePort();
  const log = NodeFS.openSync(NodePath.join(out, "metro.log"), "w");
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      NodeChildProcess.spawn(
        "npx",
        ["expo", "start", "--dev-client", "--scheme", SCHEME, "--lan", "--port", String(port)],
        {
          cwd: NodePath.join(REPO_ROOT, "apps/mobile"),
          detached: true,
          stdio: ["ignore", log, log],
          env: {
            ...process.env,
            APP_VARIANT: "development",
            CI: "1",
            EXPO_PUBLIC_T3_BEHAVIOR_PROBE: "1",
            REACT_NATIVE_PACKAGER_HOSTNAME: host,
          },
        },
      ),
    ),
    (child) => Effect.sync(() => child.pid !== undefined && process.kill(-child.pid, "SIGTERM")),
  );
  const metro = `http://${host}:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    const ready = yield* HttpClient.get(`${metro}/status`).pipe(
      Effect.flatMap((response) => response.text),
      Effect.provide(FetchHttpClient.layer),
      Effect.orElseSucceed(() => ""),
    );
    if (ready.includes("running")) return metro;
    yield* Effect.sleep("1 second");
  }
  return yield* new DeviceError({ message: `Metro never started; see ${out}/metro.log.` });
});

const decodeRows = (file: string): ReadonlyArray<SampleRow> =>
  NodeFS.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SampleRow);

function resultsFor(rows: ReadonlyArray<SampleRow>): ReadonlyArray<CaseResult> {
  const keys = [...new Set(rows.map((row) => `${row.id}\u0000${row.device}`))];
  return keys.map((key) => {
    const [id, device] = key.split("\u0000") as [string, string];
    const testCase = CASES.find((entry) => entry.id === id);
    return caseResult(
      id,
      device,
      testCase?.key ?? "",
      rows.filter((row) => row.id === id && row.device === device),
    );
  });
}

const command = Command.make(
  "mobile-behavior",
  {
    out: Flag.String("out").pipe(Flag.withDescription("Directory for results and run state.")),
    device: Flag.String("device").pipe(Flag.withDescription("Simulator UDID.")),
    deviceConfig: Flag.String("device-config").pipe(
      Flag.withDescription("The --config path device_open returned for this device."),
    ),
    deviceSession: Flag.String("device-session").pipe(
      Flag.withDescription("The --session name device_open returned for this device."),
    ),
    deviceName: Flag.String("device-name").pipe(
      Flag.withDescription('Simulator name as Metro lists it, e.g. "iPhone 17 Pro".'),
    ),
    pose: Flag.Literals("pose", POSES).pipe(Flag.withDefault<Pose>("phone")),
    label: Flag.String("label").pipe(
      Flag.withDescription("Column name in the scoreboard; defaults to the pose."),
      Flag.optional,
    ),
    cases: Flag.String("case").pipe(
      Flag.withDescription("Comma-separated case ids."),
      Flag.optional,
    ),
    samples: Flag.Int("samples").pipe(Flag.withDefault(3)),
    baseline: Flag.String("baseline").pipe(
      Flag.withDescription("results.jsonl from an earlier run to compare against."),
      Flag.optional,
    ),
    agentDevice: Flag.String("agent-device").pipe(
      Flag.withDefault(NodePath.join(NodeOS.homedir(), ".t3/userdata/device/bin/agent-device")),
    ),
    forgetOtherEnvironments: Flag.Boolean("forget-other-environments").pipe(
      Flag.withDescription(
        "Remove the app's other saved environments first. Only for a simulator kept for this eval.",
      ),
    ),
    host: Flag.String("host").pipe(
      Flag.withDescription(
        "Address the simulator uses to reach this machine; defaults to the tailnet IP.",
      ),
      Flag.optional,
    ),
  },
  Effect.fn("mobileBehavior.main")(function* (flags) {
    const out = NodePath.resolve(flags.out);
    NodeFS.mkdirSync(out, { recursive: true });
    const label = Option.getOrElse(flags.label, () => flags.pose);
    const wanted = Option.map(flags.cases, (ids) => new Set(ids.split(",").map((id) => id.trim())));
    const selected = CASES.filter(
      (testCase) =>
        Option.match(wanted, { onNone: () => true, onSome: (ids) => ids.has(testCase.id) }) &&
        (testCase.poses?.includes(flags.pose) ?? true),
    );
    if (selected.length === 0) return yield* new DeviceError({ message: "No cases match." });
    const host = Option.getOrElse(flags.host, reachableHost);
    const startedAt = yield* Clock.currentTimeMillis;

    const env = yield* startEnvironment({ baseDir: NodePath.join(out, "env"), deviceHost: host });
    const tag = (yield* uuid).slice(0, 4);
    const titles = { long: `Long settled thread ${tag}`, second: `Second thread ${tag}` };
    yield* Console.error(`Seeding a 60-turn thread on ${env.origin}...`);
    const longThread = yield* env.longThread(titles.long, 60);
    const second = yield* env.launch(titles.second, "Say hi. [[eval:reply]]");
    yield* env.settled(second);

    const metro = yield* startMetro(host, out);
    const device = makeDevice({
      agentDevice: flags.agentDevice,
      targetArgs: [
        "--platform",
        "ios",
        "--udid",
        flags.device,
        "--config",
        flags.deviceConfig,
        "--session",
        flags.deviceSession,
      ],
      metro,
      deviceName: flags.deviceName,
    });
    yield* Console.error(`Opening the dev client against ${metro}...`);
    // agent-device builds the dev-client link and answers iOS's "Open in" prompt itself.
    const metroUrl = new URL(metro);
    yield* device.run(
      [
        "open",
        APP_ID,
        "--relaunch",
        "--metro-host",
        metroUrl.hostname,
        "--metro-port",
        metroUrl.port,
      ],
      240_000,
    );
    for (let attempt = 0; ; attempt++) {
      const loaded = yield* device
        .evaluate("typeof __t3Behavior")
        .pipe(Effect.orElseSucceed(() => ""));
      if (loaded === "object") break;
      // iOS asks before a URL opens another app; busy hosts can miss the first accept.
      if (attempt % 5 === 0) yield* device.run(["alert", "accept"], 60_000).pipe(Effect.ignore);
      if (attempt > 120)
        return yield* new DeviceError({
          message:
            "The probe never loaded. Is this a dev client built from this checkout's native fingerprint?",
        });
      yield* Effect.sleep("2 seconds");
    }
    if (flags.pose === "duo-closed" || flags.pose === "duo-open")
      yield* device.fold(flags.pose === "duo-closed" ? "closed" : "open");
    const pairing = yield* env.pairingUrl();
    yield* device.openUrl(
      `${SCHEME}://connections/new?pairingUrl=${encodeURIComponent(pairing)}&autoConnect=1`,
    );
    const seeded = (state: { homeList: unknown; threads: Record<string, string> }) =>
      state.homeList !== null && longThread in state.threads;
    yield* device.waitFor("the paired environment's threads on Home", seeded, 60_000);
    // Other saved environments keep cached threads (some stuck working) that skew status cases.
    const others = (yield* device.state).environments.filter((id) => id !== env.environmentId);
    if (others.length > 0 && !flags.forgetOtherEnvironments)
      return yield* new DeviceError({
        message: `The app has ${others.length} other saved environment(s). Use a simulator with no other connections, or pass --forget-other-environments to remove them.`,
      });
    const forget = (ids: ReadonlyArray<string>) =>
      device
        .evaluate(`__t3Behavior.forgetEnvironments(${JSON.stringify(ids)})`)
        .pipe(Effect.andThen(Effect.sleep("3 seconds")));
    if (others.length > 0) yield* forget(others);
    yield* Effect.addFinalizer(() => forget([env.environmentId]).pipe(Effect.ignore));
    const ctx: ScenarioContext = {
      env,
      device,
      pose: flags.pose,
      fixtures: { longThread, second, titles },
    };
    const scenarios = [...new Set(selected.map((testCase) => testCase.scenario))];
    const rows: SampleRow[] = [];
    const results = NodeFS.openSync(NodePath.join(out, "results.jsonl"), "w");
    for (const scenario of scenarios) {
      const cases = selected.filter((testCase) => testCase.scenario === scenario);
      for (let sample = 1; sample <= flags.samples; sample++) {
        const outcome = yield* env.interruptAll().pipe(
          Effect.andThen(device.reload(seeded)),
          Effect.andThen(SCENARIOS[scenario](ctx)),
          Effect.map((metrics) => ({ metrics, error: undefined })),
          Effect.catch((error) =>
            Effect.succeed({
              metrics: {},
              error: error.message,
            }),
          ),
        );
        for (const testCase of cases) {
          const failures = outcome.error
            ? []
            : testCase.checks.flatMap((check) => checkFails(check, outcome.metrics) ?? []);
          const row: SampleRow = {
            id: testCase.id,
            device: label,
            sample,
            pass: outcome.error ? null : failures.length === 0,
            failures,
            metrics: outcome.metrics,
            ...(outcome.error ? { error: outcome.error } : {}),
          };
          rows.push(row);
          NodeFS.writeSync(results, `${JSON.stringify(row)}\n`);
          yield* Console.error(
            `${testCase.id} #${sample}: ${row.pass === null ? row.error : row.pass ? "pass" : `FAIL ${failures.join("; ")}`}`,
          );
        }
      }
    }
    NodeFS.closeSync(results);
    const minutes = Math.round(((yield* Clock.currentTimeMillis) - startedAt) / 60_000);
    const summary = summarize({
      cases: selected as ReadonlyArray<MobileBehaviorCase>,
      results: resultsFor(rows),
      ...Option.match(flags.baseline, {
        onNone: () => ({}),
        onSome: (file) => ({ baseline: resultsFor(decodeRows(file)) }),
      }),
      header: `# Mobile behavior: ${label}\n\n${flags.deviceName}, ${flags.samples} samples per case, ${minutes} min. Cells show pass or FAIL and the key metric's median.`,
    });
    NodeFS.writeFileSync(NodePath.join(out, "summary.md"), summary);
    yield* Console.log(summary);
  }, Effect.scoped),
);

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
