---
"@nerima-games/mc-compose": patch
---

Make the unchecked `mergeModuleLayers` tuple boundary explicit with one type assertion. TypeScript widens the module tuple during iteration and cannot recover its output, error and input unions from the accumulator. The assertion records that limitation; it does not establish those unions through implementation type checking. Each module layer is merged once, and an empty tuple returns an empty layer without a non-null assertion.

Keep the public signature and runtime behavior. `EMPTY_MODULE_LAYER` is `Layer.empty` and needs no cast.
