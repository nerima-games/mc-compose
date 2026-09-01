---
"@nerima-games/mc-compose": patch
---

Wire the pressure plate through real player contact, and cover it in the redstone components e2e test

@nerima-games/mx-redstone's `domain/pressure-plate.ts` implements the redstone-rule half of a
plate (how many occupants become how much signal) and deliberately does not implement the other
half: deciding who is standing on it is entity/item work out of that package's scope by design.
Nothing in this host filled that gap, so a placed pressure plate never actually powered anything —
`syncRedstoneSnapshot` didn't even recognize the block, and the host had no occupancy detection to
feed it.

This adds both. `syncRedstoneSnapshot` now reads `pressure_plate` blocks into the redstone graph
as a `pressure-plate` component, and a new per-frame check compares the player's resolved pose
against every known plate's cell, flipping `active` and requesting a resync only on a genuine
occupancy edge (not every frame — plates are not the common case).

The redstone components e2e spec now drives this through actual WASD input rather than a QA
teleport: the player walks onto a plate wired to a lamp, the lamp lights, the player walks off, the
lamp goes dark. It found a second, real gap on the way — mc-compose's physics wiring collides every
solid block as a full cube (a documented, deliberate limitation; per-shape collision is a later
migration), so a plate one block above the walking surface is a wall a player cannot step onto by
walking into it. The fixture places the plate flush with the floor instead, matching how the engine
actually treats it today, and the occupancy check tests contact with a cell's top face rather than
volume overlap, since a grounded player's feet sit at a surface, never inside a block.
