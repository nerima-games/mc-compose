---
"@nerima-games/mc-compose": patch
---

Fixed a bug where a player who joined a multiplayer server once could never join again from a new device, a private window, or after clearing site storage — any rejoin without the browser-held reconnect token was rejected outright. A rejoin under a name that is not currently connected is now accepted and issued a fresh token, matching how a brand-new name was already handled. Rejection reasons sent over the connection close are now specific instead of a single generic message, so a future client can tell a player why a join failed instead of only that it did.

Note on scope: this does not add real ownership of a player name. A tokenless rejoin still requires that nobody else is currently connected under that name, but it does not require proving you are the original claimant — that was never enforced for an ordinary first join either. Pre-existing legacy-save players who have not yet bridged into the reconnect system still require their registration secret, unchanged.
