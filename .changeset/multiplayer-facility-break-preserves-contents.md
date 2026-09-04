---
"@nerima-games/mc-compose": patch
---

Fix breaking a chest, shulker box, dispenser, dropper, hopper, furnace, or brewing stand through the authoritative multiplayer server permanently destroying whatever was stored inside it, instead of dropping it like single-player already does.

The multiplayer block-break handler deleted a facility's server-side state — its container slots, a furnace's input/fuel/output, a brewing stand's bottle and ingredient — with no preceding read of its contents, so breaking one anywhere in a multiplayer game silently erased everything it held. The single-player break path was never affected: it reads a container's slots before draining it and spawns dropped-item entities preserving them.

Breaking any of these now captures its stored items first and drops them at the block, the same way single-player does. A furnace's or brewing stand's in-progress cook/burn/fuel-charge state is discarded (it isn't an item), matching single-player's own behaviour. Multiplayer containers can never hold a custom-named or enchanted item in the first place — moving one into a container or furnace is already rejected server-side — so, unlike single-player's drop path, there is no metadata to preserve here.

Left unchanged: a chest block itself still doesn't drop as an item when broken, in either mode, because the loot table has no entry for it — a separate, pre-existing gap.

`test/multiplayer-server/core.test.ts` and `e2e/multiplayer.e2e.ts` pin this: a container, a furnace, and a brewing stand (including a finished potion) are each seeded with known contents and broken through the real `BlockBreak` network path — verified to drop nothing without the fix and the exact contents with it.
