---
"@nerima-games/mc-compose": patch
---

Advance six dependency pins to current releases.

The two that change what a player sees: `mx-gameplay` 0.6.0, whose minecarts
turn corners instead of running off the track's end — its rail-shape union
gained four oriented curve values, which nothing in this app narrows
exhaustively, so the minor lands without a code change here; and `mc-render`
0.6.0, which adds arrow-key focus movement within a group.

`mx-multiplayer` 0.11.0 carries the server-side command write-through and the
completed four-lookup host-services shape. This app does not construct that
value yet — the seam wiring is its own change — so the two intervening minors
land without code changes here as well; taking them now means the seam work
consumes a settled interface.

`mx-redstone` 0.3.3, `mx-ui` 0.5.3 and `mc-save` 0.4.2 are maintenance
advances with no consumer-visible surface change for this app.
