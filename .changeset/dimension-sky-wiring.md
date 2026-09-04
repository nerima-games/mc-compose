---
"@nerima-games/mc-compose": patch
---

The Nether and the End now look like the Nether and the End: entering either changes the rendered sky, and leaving restores the overworld's.

All three dimensions previously rendered an identical sky — the only way to tell where you were was the HUD. mc-render's environment planner (`planRenderEnvironment`) had no dimension parameter at all, and this app drove it from a single global time service, so every dimension inherited whatever the overworld's sun happened to be doing.

Bumps the `@nerima-games/mc-render` pin to 0.7.0, which adds `dimension` to `planRenderEnvironment`, `WorldRendererOptions`, and the per-frame `WorldWeatherSnapshot`. The renderer's initial dimension is now set from a restored session at construction, and — the change that actually matters, since it runs every frame the player is in the game — the per-frame weather snapshot now carries `currentChunkContext.dimension`, the same source `alignActiveDimension` already keeps current for chunk streaming and entity rosters.

The Nether renders a fixed sunless haze regardless of daylight; the End renders a dark void; the overworld is unchanged. Weather particles and their audio are not yet dimension-gated — a rain or thunder cycle in progress when the player crosses into the Nether or the End will still show and sound, since mc-compose has one global weather state and mc-render's `planWeatherFrame` only reads `dimension` for the sky/fog, not for suppressing precipitation. Left as a follow-up rather than folded into this change.

`e2e/dimension-sky.e2e.ts` pins this against the real WebGL2 context: the canvas's GL clear colour (what `setEnvironment` ultimately drives via `renderer.setClearColor`) must change on entering the Nether, change again on entering the End, and land back close to the overworld's original colour on return — closer than to either dimension visited, since the overworld's own sky drifts slightly with the day/night clock over the seconds the test spends elsewhere. Also adds a `gameplay.enterEnd` QA command, symmetric to the existing `enterNether`/`enterOverworld`, so the End side of this could be exercised at all.
