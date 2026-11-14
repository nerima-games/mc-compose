---
"@nerima-games/mc-compose": minor
---

Add C1 module QA namespace composition, save-slice aggregation, and typed QA dispatch.

This is a breaking change to the public `composeGame` API. Because the package is still 0.x, Changesets records it as a minor release.

Migrate callers by sequencing composition inside an Effect workflow:

```ts
const program = Effect.gen(function* () {
  const game = yield* composeGame(modules, options)
  return game
})
```

The second `ComposeOptions` argument is optional; omitting it keeps the standard stage skeleton. Handle failures in the Effect error channel, or use `yield* Effect.result(composeGame(modules, options))` and branch on the failure tag for `DuplicateModuleContract`, `ComposeOptionsError`, `Schema.SchemaError`, and `StageOrderError`.
