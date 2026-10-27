# Mobile behavior

Drives the T3 Code iOS app on a simulator and checks what it does: scroll position, frame drops, composer drafts and focus, status labels, Live Activities, and which thread opens. Each case reproduces a real bad experience from an issue, or guards a fix. It is the scoreboard for the mobile hill climb.

No model runs. The run starts its own server with one provider, `evalbot`: an Fx instance backed by [`fake-fx.ts`](fake-fx.ts), which replies by script. A `[[eval:…]]` marker in a message picks the reply: a paced stream, a held turn, a question, two subagents, or a failure. The run also starts its own Metro with the dev-only behavior probe ([`behavior-probe.ts`](../../apps/mobile/src/features/development/behavior-probe.ts)) compiled in. It reads app state through Metro's Hermes inspector and drives touches through T3's `agent-device`.

## Run

Pick a free simulator with `device_list`, then `device_open` it. Use the UDID, `--config`, and `--session` it returns. The dev client must match this checkout's native fingerprint (`vp run mobile:install ios`, see the `test-t3-mobile` skill).

```sh
cd evals
pnpm mobile-behavior --out runs/iphone --label iphone-17-pro \
  --device <udid> --device-config <config> --device-session <session> \
  --device-name "iPhone 17 Pro" --case scroll-up-never-teleports --samples 1
```

- `--device-name` is the simulator's name, as Metro's inspector lists it.
- `--pose phone|duo-closed|duo-open|ipad` folds an iPhone Duo first and picks Duo-only cases. Default `phone`.
- `--case <ids>` (comma-separated), `--samples <n>` (default 3), `--baseline <results.jsonl>` to show an earlier run beside each result.
- `--host` is this machine's address as the simulator sees it. The default is the tailnet IP, so a simulator on another Mac reaches the server and Metro.
- Output: `results.jsonl` (one row per case sample), `summary.md` (the scoreboard), and `env/` and `metro.log` for debugging.

Each sample reloads the app's JS and starts from Home. A scenario runs once per sample and grades every case that uses it. A case fails when half or more of its samples fail. Cells show the median of the key metric.

**Cost.** No paid models. A full run is about 25 minutes on one simulator with 3 samples: 1 minute to seed a 60-turn thread and load the bundle, then about 30 seconds per scenario sample. Run devices in parallel, one run each; each run owns its server, Metro, and port.

## Metrics

- **Scroll.** The probe reads the thread list's state on every JS frame and records each visible row's y on screen (list position minus scroll offset). A list that shifts its offset to hold content still shows no motion. `backwardPx` is the largest move against the drag. `teleports` counts one-frame moves over 400 pt, which is faster than a real fling. `maxFromEndPx` is the distance from the latest message.
- **Jank.** JS-thread frames come from `requestAnimationFrame` in the probe. UI-thread frames come from a worklet `requestAnimationFrame` loop on the UI runtime. Percentiles and dropped-frame share are against the device's own refresh rate. Simulators render at 60 Hz, so check 120 Hz behavior on a device.
- **Composer.** The draft store, the text the native editor was given, whether the editor expanded, and whether the keyboard is up.
- **Status.** Each Home row's status from the app's own `resolveThreadListV2Status`, and the Working shelf count, against server state.

## Add a case

Cases are data in [`cases.ts`](cases.ts). Each has an `id`, a `kind` (`bad` for an open issue, `guard` for a landed fix, `control` for ordinary use), its `source`, the `scenario` that makes its metrics, a `key` metric, and `checks`. A new flow goes in [`scenarios.ts`](scenarios.ts) and returns metrics. Add the case before the fix: it must fail on `main` while the bug exists.

## Not covered here

- Live Activity content, end, and tap routing (#15728, #16229, #16241, #18997). Activities start only after a T3 Connect relay login, and their content arrives by push. The probe logs every start and end the app makes, so these can run against a relay-connected device.
- Notification tap routing (#18997). It needs a delivered notification banner to tap.
- Native editor scroll when the keyboard hides (#22006). The editor's scroll offset is native and the probe cannot read it.
- The background-work pill (#21342) and async questions while the agent keeps working (#24914). Fx has no background tasks and its questions block the turn; these need Claude or Codex replays.
- 120 Hz frame pacing. Simulators run at 60 Hz.
