---
"@nerima-games/mc-compose": minor
---

Add C1 module QA namespace composition, save-slice aggregation, and typed QA dispatch.

This changes public composition contracts. Because the package is still 0.x, Changesets records it as a minor release.

- `GameModule` accepts `RIn`, QA namespace, save-slice and registration requirement type parameters. `registerModule` preserves these types when evaluating frame-stage registration.
- `ComposedGame<Modules>` retains the module tuple and exposes `modules`, `qaNamespaces`, `saveSlices`, `qaBridge` and `layers`. `layer` remains a compatibility alias. Layer inputs remain requirements; QA and registration requirements supplied by module outputs are removed from the composed layer's input requirements.
- `BrowserSession.game` is typed as `ComposedGame<ReadonlyArray<GameModule>>`.
- New exports are `DuplicateModuleContract`, `InvalidModuleContract`, `ComposeOptionsError`, `QaOperationNotFound`, `QaBridge` and `QaBridgeApi`. Malformed QA or save-slice collections produce `InvalidModuleContract`; identifier collisions produce `DuplicateModuleContract`.
- `QaBridge` is a single context service. Requirements stay on the `QaBridgeApi` value until the host provides `game.layers`; the host installs the resulting API without requirements in the service.

Migrate callers by sequencing composition inside an Effect workflow:

```ts
const program = Effect.gen(function* () {
  const game = yield* composeGame(modules, options)
  return game
})
```

The second `ComposeOptions` argument is optional; omitting it keeps the standard stage skeleton. Handle failures in the Effect error channel, or use `yield* Effect.result(composeGame(modules, options))` and branch on the failure tag for `DuplicateModuleContract`, `InvalidModuleContract`, `ComposeOptionsError`, `Schema.SchemaError`, and `StageOrderError`.
