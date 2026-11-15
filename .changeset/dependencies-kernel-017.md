---
"@nerima-games/mc-compose": minor
---

Align published runtime dependency pins with `main`:

- `@nerima-games/mc-kernel`: `0.7.1` → `0.17.0`
- `@nerima-games/mc-render`: `0.7.0` → `0.11.0`
- `@nerima-games/mc-save`: `0.4.2` → `0.8.0`
- `@nerima-games/mc-sim`: `0.4.2` → `0.11.1`
- `@nerima-games/mc-worldgen`: `0.3.2` → `0.9.1`
- `@nerima-games/mx-gameplay`: `0.6.0` → `0.11.0`
- `@nerima-games/mx-multiplayer`: `0.11.0` → `0.17.0`
- `@nerima-games/mx-redstone`: `0.3.3` → `0.7.1`
- `@nerima-games/mx-ui`: `0.5.3` → `0.10.0`
- `effect`: `3.22.1` → `4.0.5`

Remove the direct dependencies `@nerima-games/mc-audio` (`0.2.8`), `@nerima-games/mc-physics` (`0.2.2`), and `@nerima-games/mc-playground-kit` (`0.3.1`). The published `v0.2.13` source did not import these three packages, so removing them does not affect consumers' source code.
