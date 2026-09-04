---
"@nerima-games/mc-compose": patch
---

Fix a chest staying open in multiplayer after the player asked to close it — moving an item into or out of a chest and then immediately closing the screen could leave it stuck open, showing "Wait for the pending facility action before closing" until the player noticed and pressed again.

Closing a chest sends its own network command, and that command was refused outright whenever another facility command (the transfer the player had just made) was still waiting on the server — which is the ordinary rhythm of using a chest, not an edge case. Nothing remembered the refused close, so the screen simply sat there until a second, separate attempt.

A close that arrives while another facility command is in flight is now remembered and retried automatically the moment that command resolves, mirroring the existing queued-hotbar-selection mechanism used for the same kind of collision — the player never has to press again. This intentionally does not copy the fix used for the hotbar-selection race in 0.2.8: chest occupancy is partially shared with other clients, so closing locally before the server confirms it could leave the server believing this client is still attached, which would be a worse and less visible bug than the one being fixed.

`e2e/multiplayer.e2e.ts` pins this: a real two-click item transfer into a chest, followed immediately by pressing Escape with no settling wait, must still result in the chest closing on its own — verified to fail (stuck open) without the fix and pass with it.
