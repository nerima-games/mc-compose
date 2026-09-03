---
"@nerima-games/mc-compose": patch
---

Route five more simulation-gated waits that the earlier sweeps missed

Two prior passes classified waits by property — does this depend on the simulation advancing — and
routed everything they found that way. Continuous integration kept disagreeing with itself on
reruns of the same commit afterwards anyway: 39 same-commit run pairs, 4 disagreements, each one a
single spec failing in one run and passing in the other. That is the signature of a wait bounded by
wall-clock time standing next to ones already fixed, not a new mechanism.

Found by re-reading each already-routed file for an assertion sitting next to a
`waitForSimulationProgress` call but not wrapped by one, and by reading files the earlier sweeps
never touched at all:

- The furnace cook-progress assertion in `player-experience.e2e.ts`, two lines below the comment
  that already says fuel consumption and smelt progress are both simulation-gated — the fuel and
  output waits were routed, this one in between was not.
- Brewing's own start transition in `brewing-effects.e2e.ts` (the potion output field populating
  with its countdown) — the completion waits a few lines down were routed, the start was not.
- The sticky-piston lever/piston extend and retract snapshots, in a file the earlier sweeps never
  touched — redstone signal propagation runs on the same tick schedule as everything else here.
- The Nether bed explosion's block-destruction-and-damage settle in `sleep.e2e.ts`, in a file that
  already imports the helper for its other test and simply didn't use it for this one.
- The End dragon's death settle in `end-journey.e2e.ts` — health hitting zero is observed inside the
  attack loop directly, but the exit portal materializing, the egg drop, and the experience award are
  follow-on effects the simulation applies on a later tick, the same shape documented elsewhere in
  this suite for a zombie's death-drop entity.

Verified the mechanism directly rather than only by re-reading: a deterministic frame stall (the
same `stallEachAnimationFrame` technique `bow-projectile.e2e.ts` already uses, because CPU
throttling does not reproduce this) makes the pre-fix sticky-piston assertion fail exactly as
described — "Timeout 5000ms exceeded while waiting on the predicate" with the transition still
in flight — and the routed version pass under the identical stall.

Two other shapes were investigated and found already handled: the touch-input and persistence
delta-threshold assertions this project fixed before are still expressed in simulated time, not
per-sample; the multiplayer-authority suites poll their own network revision counter rather than
the frame counter, which a prior pass already identified as the correct shape for that signal.
