---
"@nerima-games/mc-compose": patch
---

Express a movement threshold in game time, and stop the wait helper's diagnostic losing a race

Two fixes that share a root: a quantity measured against real time when the thing it describes is
governed by simulated time.

The touch-input test waits for horizontal drift to settle, comparing the distance between
successive samples against a floor. That floor is a speed, and it was denominated per sample —
which only means what it should if the simulation advances at a fixed rate. On a slow host less
ground is covered inside the same interval, so movement that is proceeding perfectly correctly
reads as already settled, or fails to clear the bar. Preserving the original sampling cadence was
tried first and is not sufficient, because the cadence was never the problem.

It now compares distance against elapsed simulated time, using the cumulative simulation clock the
application already publishes. The bar keeps the value its author intended, expressed as blocks
per simulated second rather than blocks per sample, and a pair of samples too close together to
judge is treated as undecided rather than as settled — so a vanishing denominator can never
produce a false pass. Because the assertion no longer depends on how often it is sampled, the test
needs no special cadence and polls at the default.

Separately, the wait helper's real-time backstop defaulted to exactly the framework's own default
test timeout, so on any test that had not raised its timeout the generic message won the race and
hid the helper's own — the one that says whether frames were still advancing, which is the whole
diagnostic value. An audit found seventeen of nineteen call sites in that position. Rather than
annotate each, the default now derives from whatever timeout the test is actually running under,
less a margin, so the useful message arrives first automatically and any future adopter inherits
it without having to know.
