---
"@nerima-games/mc-compose": patch
---

Fix a boat placed on water not actually floating in it, so holding forward left it crawling in place instead of sailing.

A live QA pass drove a boat as far as the surface allows — crafted, placed by a real right-click (a boat entity genuinely appeared), and mounted (the player's pose snapped onto it) — but could only test propulsion on a dry stone floor, the only terrain the QA fixtures offered without new work, and reported "could not test on water" rather than a defect.

`gameplay.seedBoatWaterEncounter` closes that gap: it terraforms an open-water pool and equips the boat item, but deliberately leaves placement, boarding, and driving as real actions, so a browser test exercises the same `targetedBlock()` raycast placement, boarding-distance check, and `vehicleService`/frame stage (`gameplayStages`) production play uses.

That test found a real defect: a boat is placed at `target.adjacentPosition`, the empty cell next to whichever face of the target block was hit. Aiming down at open water — the common way to place a boat on it — hits the water block's TOP face, so the boat lands one cell ABOVE the water, not in it. mx-gameplay's `vehicle-frame.ts` only recognizes "in water" by reading the boat's own cell (and the one above it), so a boat placed this way was never detected as being in water and only ever received `stepBoat`'s 15% off-water crawl acceleration — regardless of how long or hard forward was held. The same bug existed in the multiplayer server's authoritative placement handling.

Fixed the same way a minecart already lands on the rail's own cell rather than beside it: a boat placed by targeting water now lands in the water's own cell. `e2e/boat-water.e2e.ts` pins the fix — placement lands in the water cell, forward input reaches a peak speed within the same order of magnitude as vanilla's ~1.8 blocks/sec cruise (measured ~1.87), and steering turns the boat's heading.
