---
"@nerima-games/mc-compose": patch
---

Fix the QA hostile-spawn fixture so a full-health enderman or blaze can actually be fought.

`gameplay.spawnFullHealthEnderman` and `gameplay.spawnFullHealthBlaze` repositioned the player
with no ground underneath, so the player fell out of melee and bow range within a fraction of a
second of the mob appearing. The spawned mob also carried no initial behaviour, so an enderman
never teleported — it just stood there inert, indistinguishable from a passive mob. Both QA
commands now leave the player standing on solid ground next to a mob that behaves like every
other hostile spawn.
