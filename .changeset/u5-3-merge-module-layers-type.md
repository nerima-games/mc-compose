---
"@nerima-games/mc-compose": patch
---

Make the `mergeModuleLayers` tuple boundary explicit with one type assertion because TypeScript widens the module tuple during iteration and cannot recover its output, error, and requirement types from the accumulator. The assertion records this unchecked boundary; it does not prove those unions through implementation type checking. Each module layer is merged once, and an empty tuple returns `Layer.empty` without a non-null assertion.

The public signature carries module requirements. `EMPTY_MODULE_LAYER` is `Layer.empty` and needs no cast.
