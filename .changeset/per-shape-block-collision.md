---
"@nerima-games/mc-compose": patch
---

Collide blocks with their real registry shape instead of a full cube

`pressure-plate-real-input`'s changeset documented the limitation this closes: mc-compose's
`simPhysicsConfig.resolve.blockPropertiesAt` returned `BLOCK_PROPERTY_DEFAULTS` — kernel's generic
opaque-solid-cube properties — for every solid block, regardless of what that block actually is.
mc-physics's resolver already reads `properties.collisionShape` to pick a block's real collision
box (`resolve-shapes.ts`), and mc-kernel already carries a `collisionShape` per block in its
registry (`full`, `slab`, `pressurePlate`, `cactus`, `none`); mc-compose just never consulted it, so
a slab, a plate or a cactus all collided as an impassable full cube.

`blockPropertiesAt` now resolves the real block at each cell via `resolvedBlockOfId` (the same
accessor mc-physics's own `kernel-world.ts` adapter uses) and returns its actual properties. An
unloaded chunk or an out-of-world cell still falls back to `BLOCK_PROPERTY_DEFAULTS` — collision
must still fail closed to solid there, or the edge of the loaded world becomes a hole a player falls
through forever.

`isStandingOnCell` — the pressure-plate occupancy check — assumed a standing surface is always
`cell.y + 1`, true only for a full cube. It now reads the same collision shape the resolver uses and
stands on that shape's real top face, so occupancy detection keeps working once a plate is no longer
sunk to a full block's height.

A real, non-full shape alone was not enough: mc-physics's axis-sequential resolver blocks horizontal
movement on any vertical overlap however thin, so a plate one cell above the walking surface was
still a wall — its own test suite has a case titled exactly that, "with no step height injected, the
same slab is a wall", and states plainly that the mechanism (`tryStepUp`, resolve-support.ts) is
mc-physics's but the value is the host's. `simPhysicsConfig.resolve.stepHeight` was never set, so it
defaulted to off. It's now `PLAYER_STEP_HEIGHT_M = 0.6`, the same reference value mc-physics's own
suite uses throughout — enough to climb a plate, a slab or a carpet by walking into it, same as
vanilla, while a full block (1.0) is still well past it and still needs a jump.

The pressure-plate QA fixture (`qa-fixtures.ts`) no longer places the plate flush with the floor as
a stand-in for this limitation; it sits on top of its own floor tile, one cell above the wire and
lamp's floor, the way it actually sits in the game being reproduced.

`environmental-contact-damage.e2e.ts`'s cactus test asserted no volume overlap between the player and
the cactus's nominal cell — true only because the old full-cube collision stopped the player exactly
at the cell's outer face. A cactus's real shape is inset a sixteenth on X and Z, so the collidable
surface sits a sixteenth inside that face, and a player stopped against it now legitimately overlaps
the nominal cell by that same sixteenth. That assertion is updated to match; the side-touch predicate
right below it, which is what actually distinguishes contact from immersion, is unchanged and still
passes.
