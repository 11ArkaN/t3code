import { type RemoteOpenTarget } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import {
  isTailscaleIpv4Address,
  readTailscaleSshEnabled,
  readTailscaleStatus,
} from "@t3tools/tailscale";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeOS from "node:os";

const SSH_PORT = 22;
const TAILSCALE_CACHE_TTL = Duration.seconds(60);

const tailscaleIpv4AddressKey = (): string =>
  [
    ...new Set(
      Object.values(NodeOS.networkInterfaces())
        .flatMap((addresses) => addresses ?? [])
        .filter(
          (address) =>
            !address.internal &&
            address.family === "IPv4" &&
            isTailscaleIpv4Address(address.address),
        )
        .map((address) => address.address),
    ),
  ]
    .toSorted()
    .join(",");

export class RemoteOpenTargets extends Context.Service<
  RemoteOpenTargets,
  {
    readonly resolveTargets: () => Effect.Effect<ReadonlyArray<RemoteOpenTarget>>;
  }
>()("t3/environment/RemoteOpenTargets") {}

/** @public */
export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const net = yield* NetService.NetService;

  // Every `tailscale` spawn can raise a macOS "access data from other apps" prompt, and
  // targets resolve on each client connect. Key by tailnet addresses so network changes refetch.
  const magicDnsNameCache = yield* Cache.make({
    capacity: 1,
    timeToLive: TAILSCALE_CACHE_TTL,
    lookup: (_addresses: string) =>
      readTailscaleStatus.pipe(
        Effect.map((status) => status.magicDnsName),
        Effect.orElseSucceed(() => null),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
  });
  const sshEnabledCache = yield* Cache.make({
    capacity: 1,
    timeToLive: TAILSCALE_CACHE_TTL,
    lookup: (_addresses: string) =>
      readTailscaleSshEnabled.pipe(
        Effect.orElseSucceed(() => false),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
  });

  const resolveTargets = Effect.gen(function* () {
    // Check both loopback families: sshd can be bound IPv6-only.
    const sshdListening = yield* Effect.zipWith(
      net.hasListenerOnHost(SSH_PORT, "127.0.0.1"),
      net.hasListenerOnHost(SSH_PORT, "::1"),
      (ipv4, ipv6) => ipv4 || ipv6,
    );
    const username = yield* HostProcess.Username;
    const tailscaleKey = tailscaleIpv4AddressKey();
    const magicDnsName = yield* Cache.get(magicDnsNameCache, tailscaleKey);

    const targets: Array<RemoteOpenTarget> = [];

    if (!sshdListening) {
      // Tailscale SSH needs no local sshd; tailscaled alone does not prove an SSH route.
      if (magicDnsName !== null && (yield* Cache.get(sshEnabledCache, tailscaleKey))) {
        targets.push({
          kind: "tailscale",
          host: magicDnsName,
          ...(username === null ? {} : { username }),
        });
      }
      return targets;
    }

    if (magicDnsName !== null) {
      targets.push({
        kind: "tailscale",
        host: magicDnsName,
        ...(username === null ? {} : { username }),
      });
    }

    // hostname() may be an FQDN; mDNS always uses <first-label>.local.
    const hostname = yield* HostProcess.Hostname;
    const shortHostname = hostname.split(".")[0]?.trim();
    if (shortHostname !== undefined && shortHostname.length > 0) {
      targets.push({
        kind: "mdns",
        host: `${shortHostname}.local`,
        ...(username === null ? {} : { username }),
      });
    }

    return targets;
  });

  return RemoteOpenTargets.of({
    resolveTargets: Effect.fn("RemoteOpenTargets.resolveTargets")(function () {
      return resolveTargets;
    }),
  });
});

export const layer = Layer.effect(RemoteOpenTargets, make);
