# Mobile behavior

Drives the T3 Code iOS app on a simulator and checks what it does: scroll position, frame drops, composer drafts and focus, status labels, and which thread opens. Each case reproduces a real bad experience from an issue, or guards a fix. It is the scoreboard for the mobile hill climb.

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
- The app must have no other saved environments, since their cached threads skew the status cases. The run stops if it finds any. On a simulator kept for this eval, `--forget-other-environments` removes them. The run removes its own environment when it ends.
- `--host` is this machine's address as the simulator sees it. The default is the tailnet IP, so a simulator on another Mac reaches the server and Metro.
- Output: `results.jsonl` (one row per case sample), `summary.md` (the scoreboard), and `env/` and `metro.log` for debugging.

Each sample stops any unfinished turn, reloads the app's JS, and starts from Home. Composer flows use new threads, so drafts from earlier samples never mix in. A scenario runs once per sample and grades every case that uses it. A case fails when half or more of its graded samples fail. It is `incomplete` when scenario errors outnumber graded samples. Cells show the median of the key metric.

**Cost.** No paid models. A full run takes about 15 minutes per simulator with 3 samples: about 2 minutes to seed a 60-turn thread and load the bundle, then the scenarios. Run devices in parallel, one run each; each run owns its server, Metro, and port.

## Metrics

- **Scroll.** The probe reads the thread list's state on every JS frame and records each visible row's y on screen (list position minus scroll offset). A list that shifts its offset to hold content still shows no motion. `backwardPx` is the largest move against the drag. `teleports` counts one-frame moves over 400 pt, which is faster than a real fling. `maxFromEndPx` is the distance from the latest message.
- **Jank.** JS-thread frames come from `requestAnimationFrame` in the probe. UI-thread frames come from a worklet `requestAnimationFrame` loop on the UI runtime. Percentiles and dropped-frame share are against the display's budget: 120 Hz when its fastest frames come under 12 ms, else 60 Hz. Simulators render at 60 Hz, so check 120 Hz behavior on a device. Injected swipes load the simulator's UI thread, so swipe-driven cases grade JS frames only.
- **Composer.** The draft store, the text the native editor shows (from the accessibility tree), whether the editor expanded, and whether the keyboard is up.
- **Status.** Each Home row's status from the app's own `resolveThreadListV2Status`, and the Working shelf count, against server state.

## Add a case

Cases are data in [`cases.ts`](cases.ts). Each has an `id`, a `kind` (`bad` fails on `main` today, `guard` passes and must keep passing, `control` is ordinary use), its `source`, the `scenario` that makes its metrics, a `key` metric, and `checks`. A new flow goes in [`scenarios.ts`](scenarios.ts) and returns metrics. Add the case before the fix: it must fail on `main` while the bug exists.

## Not covered here

- Live Activities (#25026, #15728, #16229, #16241, #18997). The app starts one only after a T3 Connect relay login, and its content arrives by push, so none start against the eval's server.
- Notification tap routing (#18997). It needs a delivered notification banner to tap.
- Native editor scroll when the keyboard hides (#22006). The editor's scroll offset is native and the probe cannot read it.
- The background-work pill (#21342) and async questions while the agent keeps working (#24914). Fx has no background tasks and its questions block the turn; these need Claude or Codex replays.
- 120 Hz frame pacing. Simulators run at 60 Hz.
