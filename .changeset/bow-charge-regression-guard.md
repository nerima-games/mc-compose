---
"@nerima-games/mc-compose": patch
---

Un-park the bow projectile test and add a regression guard for the draw-charge clamp

Bow draw duration is measured in real elapsed time while physics stays on the clamped
per-frame delta, and that was already correct in the code — but nothing explained why, and
nothing would have caught it going wrong.

The distinction matters and is now documented at the call site: the clamp exists so a stalled
tab resumes in slow motion rather than teleporting through one enormous step, which is right
for a physics integration and wrong for the duration of a player's input. How long someone
held a button is a wall-clock fact that does not become less true because the renderer stalled.
Folding the two back together silently discards genuinely long bow holds on slow hardware.

The parked test is un-parked; its comment described a defect that had already been fixed, and
cited line numbers that had since moved.

A second test guards the distinction. It forces every real frame to cost well past the clamp,
then holds the bow for a duration that cannot accumulate enough clamped time to fire but is
comfortably long in real time. Its margin is structural rather than arithmetic — the stall is
long enough that too few frames can fit inside the hold for the clamped path to reach the
threshold under any scheduling — because an earlier version of the same test sat exactly on
that threshold and passed against deliberately broken code. The comment records that near miss
so the numbers are not tuned back toward the boundary.

Validated in both directions on isolated ports: it fails against the reverted implementation
and passes against the current one.
