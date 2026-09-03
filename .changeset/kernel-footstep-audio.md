---
"@nerima-games/mc-compose": patch
---

Advance the kernel pin so footsteps are audible across the world.

The block registry previously carried a footstep material for fifteen of its
blocks and left the rest on the default, which the audio package maps to no cue
at all — so a player walking over most terrain, deepslate included, heard
nothing underfoot. The kernel release this pin picks up covers ninety-two more
blocks using the existing four-value vocabulary.

The data lives in the kernel, so this pin is what actually reaches a player;
until it lands the shipped game stays silent regardless of the upstream fix.
