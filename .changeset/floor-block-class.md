---
"@nerima-games/mc-compose": patch
---

Place the floor block under every QA fixture that restores the shared spawn pose

A fixture that puts the player at a pose without placing the block that pose stands on leaves
them falling through unset terrain for the whole encounter, and a right-click raycast from a
continuously dropping eye height misses whatever it was aimed at.

That defect has now been found three times, in three separate investigations, and each time it
was first attributed to something else — input delivery, processor contention, a synthetic
pointer lock. It is invisible as a pattern precisely because the fixtures that do place the block
keep working, so each failure looks unrelated to the last.

So this closes it as a class rather than as instances. Every call site restoring that pose was
audited: eight already placed the block, nine did not, and all nine now do. Counting the
placements against the restores confirms one for one, with none left.

Nine includes fixtures no current test right-clicks through. A fixture that drops the player is
wrong whether or not today's assertions happen to notice, and "nothing raycasts through this one"
is a claim with an expiry date.
