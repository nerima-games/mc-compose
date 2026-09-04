---
"@nerima-games/mc-compose": patch
---

Fix the multiplayer server silently discarding seven categories of world state on every restart.

The server correctly wrote levers, the ender dragon encounter and its revision, brewing stands, status effects, anvil-given item names, and enchantments to disk on every save, but the loader that runs on server start never read any of them back — it decoded only the older fields (blocks, inventories, vitals, containers, and so on). Any restart while pointed at the same state file — a deploy, a crash, or a routine bounce — permanently reset every lever, discarded the entire ender dragon fight's progress, emptied every brewing stand mid-brew, cleared active status effects, and erased every anvil-renamed and enchanted item, with no error and no player action required to trigger it.

The loader now reads all seven fields with the same fail-closed validation the existing fields already get: a malformed entry rejects the whole state file rather than starting with silently corrupted data, and a state file written before this fix (missing these fields entirely) still loads cleanly with those categories empty.

`test/multiplayer-server/persistence.test.ts` pins the round trip: a state populated with every category is written and read back and must come back byte-for-byte identical — verified to fail (losing exactly these seven fields) without the fix and pass with it. `test/multiplayer-server/runtime.test.ts` extends its existing fail-closed table with a malformed case for each of the seven fields.
