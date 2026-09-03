---
"@nerima-games/mc-compose": patch
---

Add browser-level proof that a minecart turns rail corners, and fix vehicle persistence

Today's mx-gameplay fix taught the rail-shape rule to steer a minecart through a 90-degree
corner instead of running it off the end of the track. That fix had proof at the package
level — a closed-rectangle regression test driven through mx-gameplay's own stepping path —
but nothing reachable from the running game: the only production path that spawns a minecart
is a real right-click against a rail block, and a fresh survival session's starter kit holds
neither a minecart nor rail (both are craftable only through a full mining-and-smelting
chain). Nobody driving the game by hand, and no browser test, could ever see the fix work.

`gameplay.seedRailTrackEncounter` closes that gap. It seeds a closed rectangular powered-rail
loop and spawns a minecart on it through the same `vehicleService` and frame stage
(`gameplayStages`) production play uses — not a hand-stepped position — so the cart's motion
afterward is the real simulation turning the corners. `gameplay.railTrackSnapshot` reports the
cart's live position and velocity. A new e2e spec, `e2e/minecart-corners.e2e.ts`, drives this
through a real browser and asserts the cart reaches cells on both axes of the loop while never
once landing outside the set of rail cells — the second half is what actually falsifies the
original bug, since the pre-fix cart ran straight off the track at a corner instead of turning.

Building the fixture also surfaced a real, previously unreachable defect: an unoccupied
vehicle's `occupant` field is `undefined` rather than an absent key, and
`PersistedVehiclesSchema` never stripped that key the way this file's other optional session
fields do, so the very first autosave after any vehicle existed in a session failed to encode
("save contains an unsupported value: undefined"). Nothing before this fixture ever put a
vehicle through session persistence at all, so the gap was invisible. Fixed at the one place a
`Vehicle` enters the persisted snapshot, mirroring how vehicle-motion.ts's own
`withoutOccupant` already represents "no occupant" everywhere else.
