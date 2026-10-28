// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import {
  createProviderVersionAdvisory,
  resolveLatestProviderVersion,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as ClaudeAdapterV2 from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ModelManifest from "../ModelManifest.ts";
import * as ProviderHostLive from "../ProviderHostLive.ts";
import * as ResetCreditCoordinator from "../resetCreditCoordinator.ts";
import { ClaudeDriver } from "./ClaudeDriver.ts";

// npm dist-tags for @anthropic-ai/claude-code when `stable` trails `latest`.
const DIST_TAGS: Record<string, string> = { stable: "2.1.308", latest: "2.1.312" };

const npmRegistry = HttpClient.make((request) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").map(decodeURIComponent).filter(Boolean);
  const tag = segments.at(-1) ?? "";
  if (url.hostname !== "registry.npmjs.org" || !segments.join("/").includes("claude-code")) {
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 })));
  }
  const body =
    tag === "dist-tags"
      ? DIST_TAGS
      : tag in DIST_TAGS
        ? { name: "@anthropic-ai/claude-code", version: DIST_TAGS[tag] }
        : { name: "@anthropic-ai/claude-code", "dist-tags": DIST_TAGS };
  return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)));
});

const layerTest = ProviderHostLive.layer.pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-claude-driver-maintenance-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(Layer.mock(ClaudeAdapterV2.ClaudeAgentSdkQueryRunner)({})),
  Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
  Layer.provideMerge(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("00000000-0000-4000-8000-000000000001")),
    }),
  ),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ModelManifest.layerTest),
  Layer.provideMerge(ResetCreditCoordinator.layerTest),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(ProviderLatestVersions.layer),
  Layer.provideMerge(Layer.succeed(HttpClient.HttpClient, npmRegistry)),
);

// The `#!/bin/sh` stub below cannot be resolved as an executable on Windows.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";

const noSpawn = ChildProcessSpawner.make(() =>
  Effect.die("Version advisory resolution must not spawn a process"),
);

it.layer(layerTest)("ClaudeDriver", (it) => {
  it.effect(
    "compares a native install on the stable update channel against npm's stable release",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs
          .makeTempDirectoryScoped({ prefix: "t3-claude-native-stable-" })
          .pipe(Effect.flatMap((directory) => fs.realPath(directory)));
        const versionPath = NodePath.join(home, ".local", "share", "claude", "versions", "2.1.308");
        const launcherPath = NodePath.join(home, ".local", "bin", "claude");
        yield* fs.makeDirectory(NodePath.dirname(versionPath), { recursive: true });
        yield* fs.writeFileString(versionPath, "#!/bin/sh\n");
        yield* fs.chmod(versionPath, 0o755);
        yield* fs.makeDirectory(NodePath.dirname(launcherPath), { recursive: true });
        yield* fs.symlink(versionPath, launcherPath);
        yield* fs.makeDirectory(NodePath.join(home, ".claude"));
        yield* fs.writeFileString(
          NodePath.join(home, ".claude", "settings.json"),
          JSON.stringify({ autoUpdatesChannel: "stable" }),
        );

        const instance = yield* ClaudeDriver.create({
          instanceId: ProviderInstanceId.make("claude-native-stable"),
          displayName: "Claude stable channel test",
          enabled: false,
          environment: [{ name: "HOME", value: home, sensitive: false }],
          config: { ...ClaudeDriver.defaultConfig(), binaryPath: launcherPath },
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, noSpawn),
          Effect.provideService(HostProcess.HomeDirectory, home),
        );
        const capabilities = yield* instance.snapshot.resolveMaintenance();
        const latestVersion = yield* resolveLatestProviderVersion(capabilities).pipe(
          Effect.provideServiceEffect(
            ProviderLatestVersions.ProviderLatestVersions,
            ProviderLatestVersions.make(),
          ),
        );

        expect(capabilities.update).toMatchObject({ executable: launcherPath, args: ["update"] });
        expect(
          createProviderVersionAdvisory({
            driver: ClaudeDriver.driverKind,
            currentVersion: "2.1.308",
            latestVersion,
            maintenanceCapabilities: capabilities,
          }),
        ).toMatchObject({ status: "current", latestVersion: "2.1.308" });
      }).pipe(Effect.scoped),
    { skip: windowsHost },
  );
});
