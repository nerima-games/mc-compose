---
"@nerima-games/mc-compose": patch
---

Fix a hotbar switch in multiplayer sometimes acting with the previously selected item instead of the one just chosen — a player pressing a number key and immediately right-clicking (placing a block, eating, drawing a bow) could act on the old slot for a real, measured window.

The client's own notion of which hotbar slot is selected (`selectedHotbarIndex`) is purely local UI focus, not authoritative game state, but in multiplayer it was only ever updated once the server echoed the selection back — never when the key was pressed. A right-click resolving before that echo read whatever was selected before. Live measurement against a real multiplayer server (localhost) found the stale window lasting 90-130ms depending on host load; any real network adds to that.

The selection now applies immediately on press in both single-player and multiplayer, exactly like single-player already did, while the network command still carries the change to the server for its own bookkeeping. `e2e/multiplayer.e2e.ts` pins this with a frame-counted (not wall-clock) assertion: after exactly one rendered frame, the HUD's selected slot must already reflect the press — verified to fail against the previous behavior and pass with the fix, both reliably across repeated runs.
