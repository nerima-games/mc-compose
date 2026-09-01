---
"@nerima-games/mc-compose": patch
---

Give the simulation wait a configurable sampling cadence, and route three more frame-gated waits

Some waits are rate-sensitive: they compare a delta between successive samples against a fixed
threshold, so the sampling interval is part of what the threshold means. Polling one of those
faster leaves the number unchanged while making the bar it expresses weaker — the assertion reads
identically and tests less. The helper therefore takes an optional sampling cadence, defaulting to
what it already did so no existing caller moves.

Three more files join the routed set — survival block placement, chunk lighting resolution, and
both villager trade-status transitions — found by asking which waits depend on the simulation
advancing rather than by matching the shapes already known.

Also fixed: the real-time backstop defaulted to exactly the global test timeout, so the generic
timeout fired first and hid the helper's own diagnostic message, which is the one that says
whether frames were still advancing. Callers close to that boundary should set a shorter backstop
explicitly.

Two candidates were investigated and deliberately left unconverted, because a cadence parameter
turns out not to be sufficient for either.

A touch-input wait compares a movement delta between samples against a minimum. Preserving its
original sampling rate keeps the threshold's meaning under a fixed frame rate, but not under a
slow one: the simulation advances less within the same wall-clock interval, so the observed delta
falls below the bar even though movement is proceeding correctly. The threshold is rate-based
against real time, and making it correct means expressing it per unit of simulated time rather
than per sample — a change to what it asserts, not to how it waits.

The two multiplayer suites carry their own progress counter keyed to network synchronisation.
Bounding them by a single page's frame counter would be actively wrong rather than imprecise: a
client whose renderer is healthy while the sync pipeline stalls would look alive, so hang
detection would never fire. They need a counterpart keyed to that signal.
