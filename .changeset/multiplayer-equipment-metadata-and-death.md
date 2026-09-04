---
"@nerima-games/mc-compose": patch
---

Fix two coupled defects in the authoritative multiplayer server: equipping a custom-named or
enchanted item was refused outright, and dying never removed or dropped worn armor.

A plain iron helmet equipped fine in multiplayer, but the same helmet renamed at an anvil or
enchanted could never be worn — `equip-item` rejected it with `invalid-command` before the
equip could even run, because the server's per-slot name and enchantment maps were keyed only
by numeric inventory-slot index and had nowhere to put metadata for an equipment slot.
Separately, and independent of the above, `applyPlayerDeaths` never read or cleared
`inventory.equipment`: driving a player's health to zero correctly emptied their carried
inventory but left every worn armor piece equipped at its exact pre-death durability, with no
drop entity spawned for any of it. Since the equip guard blocked metadata-bearing armor from
ever being worn, the two defects compounded — anything worth enchanting was both unwearable
and, had it been wearable, un-loseable on death.

The server now carries equipment-slot metadata in a small server-local map
(`equipmentAnvilNames`/`equipmentEnchantments` in `core.ts`), separate from the wire-synced,
slot-number-keyed `anvilNames`/`enchantments` maps: `equip-item` moves a source slot's name and
enchantment into it instead of refusing the command, `unequip-item` moves them back to the
resolved destination slot, and death now drops each worn piece exactly like an inventory item —
capturing its name/enchantment into the same `droppedItemMetadata` path a normal death-dropped
item already uses, and clearing the equipment slot. `unequipInventoryItem` (in
`inventory-state.ts`) now returns the resolved destination slot index instead of a bare
accept/reject reason, since the caller needs it to relocate metadata when the destination was
server-picked rather than explicit.

Deliberately left: this equipment metadata never rides the wire on its own. The anvil and
enchanting network protocols (`apps/multiplayer-shared/{anvil,enchanting}-network.ts`) bound
`slot` to `0 <= slot < 36`, matching the 36-slot inventory; extending that to cover a 5-slot
equipment key space is a wire-protocol change and was out of scope for this fix. A practical
consequence: the client's own armor-enchant damage-mitigation calculation
(`apps/web/main.ts`'s `applyPlayerDamage`) reads a purely client-local map keyed by
`equipmentMetadataKey(slot)`, and today only the single-player `equip`/`unequip` handlers
populate that map — the multiplayer branch sends the command and stops. So immediately after
this fix, a multiplayer player can equip named/enchanted armor and will no longer lose it to
death, but won't yet see its enchant-based damage mitigation applied client-side, or its glint
rendered, until `apps/web/main.ts`'s multiplayer `equip`/`unequip` handlers are taught to move
metadata the same way the single-player branch already does. That client-side change was left
for separate, sequenced work.

`test/multiplayer-server/authority.test.ts` pins all three behaviours: equipping a named
enchanted helmet now succeeds and the metadata round-trips correctly back through unequip;
plain equipped armor is dropped and the equipment slot cleared on death (isolated from
metadata, reproducing the defect as originally live-confirmed); and named/enchanted equipped
armor is dropped with its metadata intact, verified by picking the drop back up and observing
the metadata reattach to the picked-up slot. Each test was confirmed to fail against the
pre-fix code with the exact symptom described above.
