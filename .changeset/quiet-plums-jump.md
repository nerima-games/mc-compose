---
"@nerima-games/mc-compose": patch
---

Jumping no longer costs a health point. An ordinary jump was landing 3.5+ blocks in the air — past this project's `ceil(fallDistance - 3)` fall-damage rule — because the host's jump take-off speed had never been re-validated against the gravity it actually runs under; it is now tuned to a ~1.2-block apex with margin to spare.

Sprint now does something. Holding the bound Sprint key (`ControlLeft` by default) increases movement speed, matching the reference implementation's sprint speed, and prices the extra exhaustion the same way ordinary walking and jumping already do.
