---
"@nerima-games/mc-compose": patch
---

Fix the save-status indicator getting stuck on "unsaved" while the player keeps moving

A player who kept drifting — most visibly floating passively in water at spawn, with no
input held — could see the save indicator stay on "unsaved" indefinitely, even though saves
were actually succeeding underneath and nothing was ever lost. Reloading always restored the
latest state correctly; only the on-screen indicator was wrong.

The indicator flipped to "saved" only when the generation a save had just finished covering
matched whatever the *live, still-changing* generation counter read at that instant. Every
frame of movement mints a new generation, so under continuous drift the live counter had
almost always ticked forward again by the time a save's own round trip completed, and the
comparison could go an unbounded time without ever holding.

The fix compares against the generation captured at the moment a save cycle was requested,
not the generation read back later when it finishes. Once that request's own target is
covered, the indicator can honestly say "saved" for it — any newer change is already flagged
"unsaved" through the normal path the moment it happens, and the next save cycle (debounce or
the 5-second autosave) picks it up in turn. A player floating in place now sees the indicator
reach "saved" on each autosave, instead of never.

Confirmed in both directions against a real running session: with the previous comparison,
16 seconds of continuous water drift produced zero "saved" transitions; with this fix, the
same drift produces one roughly every 5 seconds (the autosave interval), and an explicit save
on solid ground still reaches "saved" immediately as before.
