---
"@nerima-games/mc-compose": patch
---

Place the floor block two QA fixtures were missing, and un-park four tests

Two encounter fixtures restored the player to a pose without placing the block that pose stands
on, so the player free-fell for the whole encounter and a right-click raycast, cast from an eye
height that had dropped more than a block, missed its target entirely.

That explains a symptom that never fit anything else: absent rather than delayed, never
reproducible under processor throttling because it was never timing, and intermittent because it
depended how far the fall had progressed when the click landed. The same defect had already been
found and fixed once for a sibling fixture; two were missed at the time.

Four tests are un-parked. Two were genuinely broken and are fixed. Two were never broken by this
and their notes were stale — one fixture already placed the block, and the other does not use that
pose at all.

Two helpers that granted a synthetic pointer lock before moving the real cursor are reordered so
no cursor movement follows the lock. That addresses a separate suspected hazard which could not
be reproduced outside the integration runner, so it removes a known-unsafe ordering rather than
fixing an observed failure.
