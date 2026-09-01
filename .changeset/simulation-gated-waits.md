---
"@nerima-games/mc-compose": patch
---

Wait on simulation progress rather than wall-clock in the browser suite, and stop concurrent checkouts sharing ports

The browser suite had been failing a different test on nearly every run, in every environment, while each test passed in isolation. Six distinct tests failed across six runs with none failing twice, which is one defect in the harness rather than six in the game.

The cause, measured rather than guessed. Every frame's simulated delta is clamped, so when the browser's frame delivery collapses under contention the simulation advances at a fraction of wall-clock speed — the observed rate was around four frames per second locally under load, and CI's own logs show about five. A window measured at 215ms at rest stretched to 770-900ms under load, consistently. Meanwhile the round trips carrying the assertions stayed under 111ms, so latency was never the problem.

That clamp is correct: it exists so a stalled tab resumes in slow motion instead of teleporting through one enormous step. What was wrong was an assumption in the tests — every wall-clock timeout silently assumed simulated time runs at real time, which is false exactly when the machine is busy. Whichever test was mid-wait when a load spike landed was the one that timed out.

So the simulation-gated waits now wait on simulation progress. A shared helper polls an atomic read of the frame counter and the value together in a single round trip, and holds two independent bounds: it fails fast if frames stop advancing at all, which is a genuine hang the previous design could not distinguish from slowness, and keeps a generous wall-clock backstop as a last resort. This is a strengthening rather than a relaxation — a bound in simulated ticks stays true on a slow machine and gets no weaker on a fast one, whereas a wall-clock bound on a simulation-gated event measures the runner's throughput instead of the game.

Deliberately unchanged: the sustained-play frame-rate assertion, whose subject is frame throughput itself, so bounding it by frame progress would be circular. It should keep failing honestly when a runner is too slow, because that failure is real information.

Separately, the harness could silently test the wrong build. Two worktrees of this repository both defaulted to the same fixed ports, and each would pass its own conflict check before racing for the URL — whichever server answered first was accepted by the other's health check. Ports are now derived from the checkout path, so concurrent checkouts have nothing to race over. Continuous integration is unaffected, having one checkout per job.

Measured: three paired runs of the same spec under the same sustained load failed three times out of three before the change and passed three out of three after. A full suite run passes with no failures.
