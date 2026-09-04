---
"@nerima-games/mc-compose": patch
---

Fix `gameplay.seedRedstoneFixtures` silently placing nothing when the player has traveled far away first, which a chained QA session read as "input goes dead" in a long session.

A full-loop QA pass reported real clicks going dead on interactions that worked fine in isolation — a redstone button press among them — with which interaction failed varying between runs. Investigating the redstone case with instrumentation (real DOM event counts, `document.pointerLockElement` state, retrying the identical click) ruled out the pointer-lock/focus theory entirely: the click event reached the page, the pointer lock spoof stayed intact, and a second identical click behaved the same as the first. The input path was never the problem.

The actual cause was upstream of input: unlike every sibling `seed*Encounter` fixture in `apps/web/main.ts` (`seedBoatWaterEncounter`, `seedPortalEncounter`, `seedRailTrackEncounter`, ...), `seedRedstoneFixtures` never called `streamAround` for its own coordinates before writing blocks there. It assumed the area stays streamed in because it sits near spawn. A chained session that visits another fixture first (or a real player who simply wanders that far and comes back) evicts the area from `streamLoaded`, and `currentChunkStore.setBlock` on an unloaded chunk is a silent no-op — every fixture block fails to place, `redstoneFixturesSnapshot` reads back nulls, and a real click on the never-placed button has nothing to act on. Frames keep advancing normally throughout, which is why it reads as "the click had no effect" rather than a hang.

`e2e/redstone-components.e2e.ts` pins the fix: seed the fixtures, travel far away (`gameplay.seedPortalEncounter`), reseed, and confirm a real click still lights the lamp.
