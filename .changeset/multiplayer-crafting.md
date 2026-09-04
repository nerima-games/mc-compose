---
'@nerima-games/mc-compose': patch
---

Let a connected multiplayer player craft. Until now they could not craft anything at all — not some recipes, none — because the crafting grid could never receive a single item, leaving the output permanently disabled.

Two independent faults had to be fixed for one craft to complete.

The grid could not be filled. Placing an item into a grid cell requires the interaction layer's carried item, and that was only ever set by the single-player slot-click handler. Multiplayer routes slot clicks through a separate selection-and-network-command system that returns before reaching it, so the carried item was permanently absent while connected. The grid now stages a copy of the selected slot's item, which leaves the server-authoritative inventory untouched: staging is local, and real items are consumed only when the server accepts the craft. Drag-to-craft remains deliberately unavailable and still says so.

The craft was then rejected anyway. The server compares revisions for strict equality and advances its own on any world activity, so a valid craft lost that race whenever anything happened between the client reading the revision and the server handling the command. The rejection carries the server's current revision, so the client now adopts it and re-issues, bounded, and only for that one reason. This was invisible before because a rejected craft set nothing the player could see; it now records the reason, which is what made the diagnosis possible.

Verified by a browser test driving real clicks against a real server and asserting on actual inventory contents and the output button's real disabled state, never a pending-status attribute. Without the staging fix the grid stays empty and the recipe never matches; without the retry the craft fails four times out of four under concurrent load and passes only when run alone.
