---
"@nerima-games/mc-compose": patch
---

Fix stepping through a working Nether portal sometimes leaving the player stuck, embedded in solid terrain with nothing to stand on and no ability to move.

`resolveNetherTravel`'s scaled destination is pure arithmetic with no knowledge of what actually occupies that cell, and the crossing placed the player there directly. On terrain that happened to be solid at the destination, the player arrived already overlapping rock rather than falling or walking into it — and mc-physics's collision resolver only pushes a body out of a boundary it crosses during a step, not one it started the frame already inside of, so nothing ever corrected it. The symptom matched a hostile-spawn defect fixed earlier the same way: not grounded, not falling, blocked in every direction, indefinitely.

A Nether crossing now searches the arrival column for the nearest clear, supported spot before settling there, matching the destination exactly whenever it was already safe. Only when no safe spot exists anywhere in the search range does it carve one at the exact arithmetic destination, so a correction never lands anywhere but at or very near where the portal math already pointed.
