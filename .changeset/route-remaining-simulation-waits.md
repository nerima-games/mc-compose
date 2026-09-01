---
"@nerima-games/mc-compose": patch
---

Route the rest of the simulation-gated waits through the progress helper

The first pass fixed the four tests that had been observed failing. Those were a sample of
whichever tests happened to be running when a load spike landed, not the set of vulnerable ones —
and two more failed on CI immediately afterwards, neither of them on that list.

So this pass classifies by the property rather than by the failure history: any wait whose
subject is a state the simulation must advance to produce. Eleven more files qualify. A
projectile in flight and a furnace consuming fuel look nothing alike as code; they are alike only
in that both need ticks to accrue before the assertion can hold.

Covered here: mining progress and completion, furnace fuel and smelt output, sleep skipping to
morning, mob pursuit and contact damage, oxygen depletion and recovery, cactus and lava contact
damage, landing and lethal falls, block destruction and item pickup, portal transitions in both
directions, spawn settling and chunk streaming, and crop growth. Two hand-derived timeout
constants are deleted along with the comment justifying them, which no longer described anything
real.

Deliberately not routed, each for a reason rather than by omission: frame-rate floors, whose
subject is throughput itself, so bounding them by frame progress would be circular; a wait on a
child process output, which is not browser simulation at all; fixture entry points the code
documents as isolated from the simulated-time path; and a short timeout inside an explicit retry
loop, which is a probabilistic-action pattern rather than a timing assumption.

One conversion was attempted and reverted. A touch-input wait compares a position delta between
successive samples against a fixed threshold, and samples deliberately slowly. Polling it faster
would leave the threshold number untouched while making the effective bar it expresses several
times weaker — the assertion would read identically and quietly test less. Converting it honestly
needs a configurable poll interval, which the helper does not yet offer, so it is left alone.
