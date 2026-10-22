# W0-10: Parity Ledger Assignment Plan

## Scope and counting

- `W0-10` names this planning stream. The 98 IDs and statuses follow `mc-dev-meta` commit `05f6b75`, file `src/domain/parity-catalog.ts`.
- A row's wave is its package implementation wave. Status is the ledger baseline, not a completion claim. If an assigned test exposes missing scoped behavior, implement it in that wave even when the ledger says `implemented`.
- Package test paths are relative to the named `mc-*` or `mx-*` repository. Reference source paths are relative to `takeokunn/ts-minecraft`; E2E paths are relative to `mc-host-web`. Existing host specs move there in W5; new feature E2Es land in W6. Use `N/A` only when package-level assertions cover the whole contract and there is no browser behavior to verify.
- Size is the effort scale from execution plan §6: S is wiring and evidence, M adds a feature to an existing package, and L adds a subsystem.
- Extensions and ledger addenda remain assigned because they are part of the 98-row ledger. They are excluded from the vanilla parity count unless the crosswalk explicitly maps them.
- The five `parity/performance/*` metrics and 22 `perf/fr-*` requirements are additional ledger rows outside the 54-feature crosswalk.

## Ledger assignments

| Ledger ID and status | Primary package | Wave | Size | Package test | mc-host-web E2E | Reference implementation path when behavior is ambiguous |
|---|---|---:|:---:|---|---|---|
| `parity/content/block-types`: `unverified` | `mc-kernel` | W2 | S | **New** `mc-kernel/test/block-registry-parity.test.ts`: compare all 108 block IDs with the reference list | N/A: exact registry IDs and count are asserted at the package boundary | `packages/core/domain/block-type.ts` |
| `parity/content/item-types`: `unverified` | `mc-kernel` | W2 | S | **New** `mc-kernel/test/item-registry-parity.test.ts`: assert the reference 122 item IDs are present | N/A: exact registry inclusion is asserted at the package boundary | `packages/core/domain/item-type.ts` |
| `parity/content/recipes`: `unverified` | `mc-sim` | W3 | S | **New** `mc-sim/test/recipe-corpus-parity.test.ts`: run all 112 crafting, smelting, and brewing recipes through their matchers | N/A: corpus coverage and matcher results are package contracts; station flows are covered by their own rows | `packages/inventory/application/recipes/` |
| `parity/content/enchantments`: `unverified` | `mx-gameplay` | W4 | M | **New** `mx-gameplay/test/enchantment-effects-parity.test.ts`: check all 24 IDs and effects including Fortune, Mending, and Silk Touch | **Existing** `e2e/item-upgrades.e2e.ts`: apply and use an enchanted item | `packages/inventory/domain/enchantment.ts`; `packages/inventory/domain/enchantment.config.ts` |
| `parity/content/mob-types`: `unverified` | `mx-gameplay` | W4 | L | **New** `mx-gameplay/test/mob-roster.test.ts`: spawn and tick all 20 reference mob types; Guardian is outside this roster | **New** `e2e/mob-roster.e2e.ts`: verify the 20-mob roster in a running host | `packages/entity/domain/mob/mobs/mob-definitions.ts`; `packages/entity/domain/mob/mobs/bat.ts`; `packages/entity/domain/mob/mobs/squid.ts`; `packages/entity/domain/mob/mobs/bee.ts`; `packages/entity/domain/mob/mobs/witch.ts`; `packages/entity/domain/mob/mobs/drowned.ts` |
| `parity/content/biomes`: `unverified` | `mc-worldgen` | W3 | S | **New** `mc-worldgen/test/biome-roster-parity.test.ts`: check the 12 reference biome IDs against fixed-seed generation | N/A: exact roster and seed distribution are package contracts | `packages/world/domain/biome-classifier.ts` |
| `parity/content/texture-atlas`: `unverified` | `mc-render` | W3 | S | **New** `mc-render/test/texture-atlas-parity.test.ts`: assert 140 tiles and a tile mapping for every block | **Existing** `e2e/render-preview.e2e.ts`: verify the rendered atlas | `scripts/generate-textures.mjs` |
| `parity/survival/movement`: `implemented` | `mc-physics` | W2 | S | **Existing** `mc-physics/test/movement.test.ts`: walk, sprint, sneak, and jump | **Existing** `e2e/movement-jump-sprint.e2e.ts` | Not required |
| `parity/survival/mining`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/mining-progress.test.ts`; `mx-gameplay/test/block-loot.test.ts`: tool tiers and harvest gating | **Existing** `e2e/survival-combat.e2e.ts`: hold-to-break | Not required |
| `parity/survival/placement`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/place-block.test.ts`: face-adjacent placement | **Existing** `e2e/block-placement-persistence.e2e.ts` | Not required |
| `parity/survival/drops`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/dropped-item-lifetime.test.ts`: merge, pickup, and despawn | **Existing** `e2e/survival-combat.e2e.ts`: collect a dropped item | Not required |
| `parity/survival/hunger`: `implemented` | `mc-sim` | W3 | S | **Existing** `mc-sim/test/vitals.test.ts`: exhaustion, starvation, and eating | **Existing** `e2e/farming.e2e.ts`: eat food | Not required |
| `parity/survival/health-fall-regen`: `implemented` | `mc-sim` | W3 | S | **Existing** `mc-sim/test/vitals.test.ts`; `mx-gameplay/test/fall-damage.test.ts`: health, regeneration, `ceil(d-3)`, and boots | **Existing** `e2e/fall-damage.e2e.ts`; `e2e/health-regeneration.e2e.ts` | Not required |
| `parity/survival/death-respawn`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/dropped-item-death.test.ts`: death scatter and respawn | **Existing** `e2e/survival-combat.e2e.ts`: respawn and bed-spawn priority | Not required |
| `parity/survival/save-load`: `implemented` | `mc-save` | W2 | S | **Existing** `mc-save/test/format-roundtrip.test.ts`; `mc-save/test/migration.test.ts`: save format round-trip and migration | **Existing** `e2e/persistence.e2e.ts`: persisted-state round-trip | Not required |
| `parity/survival/day-night`: `implemented` | `mc-sim` | W3 | S | **Existing** `mc-sim/test/time-of-day.test.ts`: full cycle, twilight, and moon phases | **Existing** `e2e/sleep.e2e.ts`: night-to-morning transition | Not required |
| `parity/survival/xp`: `partial` | `mx-gameplay` | W4 | M | **New** `mx-gameplay/test/xp-orb-mending.test.ts`: orb spawn, attraction, pickup, and Mending; retain `mc-sim/test/vitals.test.ts` for level math | **Existing** `e2e/player-experience.e2e.ts`: extend through orb pickup and Mending | `packages/entity/domain/dropped-xp-orb.ts`; `packages/entity/domain/dropped-xp-orb-resolution.ts`; `packages/entity/application/dropped-xp-orb-service.ts` |
| `parity/crafting/grid-2x2`: `implemented` | `mc-sim` | W3 | S | **Existing** `mc-sim/test/crafting.test.ts`; **new** `mx-ui/test/inventory-view-model.test.ts`: 2×2 recipes and recipe-book craftability dimming | **Existing** `e2e/player-experience.e2e.ts`: extend with recipe-book dimming | Not required |
| `parity/crafting/grid-3x3`: `implemented` | `mc-sim` | W3 | S | **Existing** `mc-sim/test/crafting.test.ts`: table-gated shaped recipes | **Existing** `e2e/player-experience.e2e.ts`: 3×3 table crafting | Not required |
| `parity/crafting/furnace`: `implemented` | `mc-sim` | W3 | S | **New** `mc-sim/test/smelting.test.ts`: fuel, output, and XP | **New** `e2e/furnace.e2e.ts` | Not required |
| `parity/crafting/chest`: `implemented` | `mc-sim` | W3 | S | **Existing** `mc-sim/test/inventory.test.ts`: 27-slot storage and persistence | **Existing** `e2e/chest-storage.e2e.ts` | Not required |
| `parity/crafting/brewing`: `implemented` | `mc-sim` | W3 | S | **New** `mc-sim/test/brewing.test.ts`: awkward potion conversion, amplification, and duration | **Existing** `e2e/brewing-effects.e2e.ts` | Not required |
| `parity/crafting/anvil`: `implemented` | `mc-sim` | W3 | S | **New** `mc-sim/test/anvil.test.ts`: repair and rename XP costs | **Existing** `e2e/item-upgrades.e2e.ts` | Not required |
| `parity/crafting/enchanting-table`: `implemented` | `mc-sim` | W3 | S | **New** `mc-sim/test/enchantment-table.test.ts`: lapis and level-based offers | **Existing** `e2e/item-upgrades.e2e.ts` | Not required |
| `parity/combat/melee`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/melee-attack.test.ts`: critical damage and charged-attack cooldown | **Existing** `e2e/survival-combat.e2e.ts` | Not required |
| `parity/combat/bow`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/bow.test.ts`: charge damage and enchantment effects | **Existing, currently fixme** `e2e/bow-projectile.e2e.ts`: resolve the fixme before counting this as evidence | Not required |
| `parity/combat/armor`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/armor.test.ts`: four tiers and damage reduction | **Existing** `e2e/survival-combat.e2e.ts`: iron armor | Not required |
| `parity/combat/shield`: `unverified` | `mx-gameplay` | W4 | M | **New** `mx-gameplay/test/shield-blocking.test.ts`: held block, front/back hits, axe disable, and durability | **New** `e2e/shield-blocking.e2e.ts` | `packages/entity/domain/combat.config.ts`; `packages/app/application/frame/stages/interaction-stage-intent.ts`; `packages/entity/domain/player-health-resolution.ts`; `packages/inventory/domain/durability.config.ts` |
| `parity/combat/status-effects`: `partial` | `mx-gameplay` | W4 | M | **Existing** `mx-gameplay/test/status-effect.test.ts`: expand effect ticks; **new** `mx-ui/test/status-effect-hud.test.ts`: effect chips | **Existing** `e2e/brewing-effects.e2e.ts`: extend with effect HUD chips | `packages/entity/domain/status-effect.ts` |
| `parity/combat/hit-feedback`: `unverified` | `mc-render` | W4 | M | **New** `mc-render/test/hit-feedback.test.ts`: combat hit events produce particles, hit-stop, tracers, and damage indicators | **New** `e2e/hit-feedback.e2e.ts`: verify combat feedback through the host path | `packages/rendering/infrastructure/particles/particle-system.ts` |
| `parity/worldgen/terrain-biomes`: `implemented` | `mc-worldgen` | W3 | S | **New** `mc-worldgen/test/terrain-biome-parity.test.ts`: fixed-seed fBm, 13 biome variants, river/lake shore gradients, and underwater shell | **Existing** `e2e/smoke.e2e.ts`; `e2e/world-lighting.e2e.ts` | `packages/world/domain/noise-primitives.ts` |
| `parity/worldgen/caves-ores`: `implemented` | `mc-worldgen` | W3 | S | **New** `mc-worldgen/test/caves-ores-parity.test.ts`: fixed-seed caves, ravines, ore distribution, gravel, and flint; assert harvest drops in the kernel suite | N/A: deterministic generation and drop tables are package contracts | Not required |
| `parity/worldgen/trees-farming`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mc-worldgen/test/biome-and-trees.test.ts`; **new** `mx-gameplay/test/farming-parity.test.ts`: till, plant, bonemeal, harvest | **Existing** `e2e/farming.e2e.ts` | Not required |
| `parity/worldgen/passive-animals`: `unimplemented` | `mx-gameplay` | W4 | L | **New** `mx-gameplay/test/animal-breeding.test.ts`: breeding, growth, cooldown, feeding, and shearing | **New** `e2e/animal-breeding.e2e.ts` | `packages/entity/domain/mob/breeding.ts`; `packages/entity/application/mob/entity-manager-breeding.ts`; `packages/app/application/frame/stages/interaction-item-use-handler/feed-animal.ts`; `packages/app/application/frame/stages/interaction-item-use-handler/shear-animal.ts` |
| `parity/worldgen/villages`: `implemented` | `mc-worldgen` | W4 | S | **Existing** `mc-worldgen/test/village.test.ts`; `mx-gameplay/test/villager-trade.test.ts`: deterministic site and trading | **Existing** `e2e/villager-trading.e2e.ts` | `packages/entity/domain/village/village-creation.ts` |
| `parity/worldgen/structures`: `implemented` | `mc-worldgen` | W3 | M | **New** `mc-worldgen/test/structure-parity.test.ts`: fixed-seed temple, monument, mansion, shipwreck, and stronghold placement | **New** `e2e/structures.e2e.ts`: fixed-seed teleport and verify each structure | `packages/world/domain/terrain/woodland-mansion.ts` |
| `parity/worldgen/nether`: `implemented` | `mc-worldgen` | W4 | S | **Existing** `mc-worldgen/test/nether-terrain.test.ts`; `mx-gameplay/test/portal-travel.test.ts`: terrain and 8:1 portal travel | **Existing** `e2e/nether-portal.e2e.ts` | Not required |
| `parity/worldgen/end-dragon`: `partial` | `mx-gameplay` | W4 | M | **Existing** `mx-gameplay/test/ender-dragon-encounter.test.ts`; **new** `mx-gameplay/test/dragon-crystal-healing.test.ts`: crystal healing, breath, and death rewards | **Existing** `e2e/end-journey.e2e.ts`: extend crystal healing and return portal checks | `packages/entity/domain/mob/ender-dragon/dragon-phase.ts`; `packages/entity/domain/mob/ender-dragon/dragon-healing.ts`; `packages/entity/domain/mob/ender-dragon/dragon-combat.ts`; `packages/entity/domain/mob/ender-dragon/dragon-death.ts` |
| `parity/worldgen/weather`: `implemented` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/weather.test.ts`: rain, thunder, lightning damage, and snow precipitation | **New** `e2e/weather.e2e.ts`: exercise weather, damage, and precipitation through host input | Not required |
| `parity/worldgen/sleep`: `partial` | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/bed-sleep.test.ts`: danger rejection, skip ratio, and spawn point | **Existing** `e2e/sleep.e2e.ts`: extend fade and respawn checks | Not required |
| `parity/survival/creative-flight`: `unimplemented` | `mc-physics` | W2 | M | **New** `mc-physics/test/creative-flight.test.ts`: flight toggle, vertical movement, and landing | **Existing** `e2e/creative-mode.e2e.ts`: extend with flight controls | `packages/entity/domain/flight.ts`; `packages/entity/domain/flight-resolution.ts`; `packages/game/application/game-mode-service.ts` |
| `parity/redstone/basic-components`: `implemented` | `mx-redstone` | W4 | S | **Existing** `mx-redstone/test/power-graph.test.ts`; `mx-redstone/test/pressure-plate.test.ts`: power propagation and pressure plates | **Existing** `e2e/redstone-components.e2e.ts` | Not required |
| `parity/redstone/repeater`: `implemented` | `mx-redstone` | W4 | S | **Existing** `mx-redstone/test/power-timing.test.ts`: one-tick delay | **Existing** `e2e/redstone-components.e2e.ts` | Not required |
| `parity/redstone/piston`: `implemented` | `mx-redstone` | W4 | S | **Existing** `mx-redstone/test/piston.test.ts`: 12-block limit and regular/sticky distinction | **Existing** `e2e/sticky-piston.e2e.ts` | Not required |
| `parity/redstone/observer`: `implemented` | `mx-redstone` | W4 | S | **Existing** `mx-redstone/test/observer.test.ts`: two-tick pulse | **Existing** `e2e/redstone-components.e2e.ts` | Not required |
| `parity/redstone/hopper`: `partial` | `mx-redstone` | W4 | M | **Existing** `mx-redstone/test/hopper.test.ts`; **new** `mx-redstone/test/hopper-transfer.test.ts`: cadence, five-slot buffer, and oriented push/pull | **Existing** `e2e/redstone-components.e2e.ts`: extend transfer and orientation checks | `packages/app/application/frame/stages/redstone-hopper-world-effects.ts` |
| `parity/redstone/comparator`: `implemented` | `mx-redstone` | W4 | S | **Existing** `mx-redstone/test/comparator.test.ts`: compare and subtract | **Existing** `e2e/redstone-components.e2e.ts` | Not required |
| `parity/redstone/dispenser`: `partial` | `mx-redstone` | W4 | M | **Existing** `mx-redstone/test/dispenser.test.ts`; **new** `mx-redstone/test/dispenser-inventory.test.ts`: rising edge, nine slots, arrow, TNT, and eject | **Existing** `e2e/redstone-components.e2e.ts`: extend inventory and firing checks | `packages/app/application/frame/stages/redstone-dispenser-world-effects.ts` |
| `parity/multiplayer/seed-handshake`: `partial` | `mx-multiplayer` | W4 | S | **New case** `mx-multiplayer/test/transport.test.ts`: joining client adopts host seed and replays earlier block edits through the protocol codec | **New case** `e2e/multiplayer.e2e.ts`: late joiner receives edits recorded before joining | `packages/network/application/server-handlers.ts` |
| `parity/multiplayer/entity-authority`: `partial` | `mx-multiplayer` | W4 | M | **New case** `mx-multiplayer/test/command-application.test.ts`: on entity-host leave, reassign authority and clear ghost entities | **New case** `e2e/multiplayer.e2e.ts`: verify observable host handoff and cleanup | `packages/network/application/server-handlers.ts`; `packages/app/application/multiplayer/multiplayer-service.ts` |
| `parity/multiplayer/player-time-sync`: `partial` | `mx-multiplayer` | W4 | S | **New cases** `mx-multiplayer/test/transport.test.ts`: round-trip player/time messages; locate and test explosion/portal transport before asserting those events | **New cases** `e2e/multiplayer.e2e.ts`: verify player/time replication; add explosion/portal only after transport mapping is found | `packages/network/domain/schemas.ts`; `packages/app/application/multiplayer/multiplayer-inbound.ts` |
| `parity/multiplayer/reconnect-binding`: `unverified` | `mx-multiplayer` | W4 | S | **New assertion** `mx-multiplayer/test/reconnect-auth.test.ts`: `isSelf` echo binds the reconnecting client to its assigned ID, including same-name peers | **New** `e2e/multiplayer-reconnect.e2e.ts`: reconnect without cross-binding | `packages/network/application/server-handlers.ts`; `packages/network/application/client-service.ts` |
| `parity/multiplayer/dedicated-server`: `partial` (**extension**) | `mx-multiplayer` | W4 | L | **New** `mx-multiplayer/test/dedicated-server-scale.test.ts`: multi-client AOI, chunk deltas, rate limits, and invalid-frame rejection | **New** `e2e/multiplayer-dedicated-server.e2e.ts`: multi-client load and fault checks | Not required |
| `parity/ux/difficulty-selector`: `implemented` (schedule as unfinished work) | `mx-ui` | W4 | S | **New** `mx-ui/test/difficulty-selector.test.ts`; `mx-gameplay/test/difficulty-mode.test.ts`; **existing** `mc-sim/test/settings.test.ts`: select and persist difficulty, suppress hostile spawns in peaceful, round-trip settings | **Existing** `e2e/player-settings.e2e.ts`: select, reload, and verify peaceful behavior | `packages/game/application/settings.schema.ts`; `packages/game/application/settings-service.ts`; `packages/presentation/settings/settings-overlay.ts` |
| `parity/ux/key-remapping`: `partial` | `mx-ui` | W4 | S | **Existing** `mc-render/test/input.test.ts`; **new** `mx-ui/test/key-remapping.test.ts`: defaults, capture, conflict, and clear-to-default | **Existing** `e2e/player-settings.e2e.ts`: remap and persist a key | `packages/presentation/settings/settings-overlay.ts`; `packages/entity/domain/key-mappings.ts` |
| `parity/ux/reduced-motion-ui-scale`: `unverified` | `mx-ui` | W4 | S | **New** `mx-ui/test/accessibility-settings.test.ts`; `mc-render/test/reduced-motion.test.ts`: persist reduced motion and 75% to 150% UI scale; suppress camera bob and roll | **Existing** `e2e/player-settings.e2e.ts`: update motion and scale settings | `packages/game/application/settings.schema.ts`; `packages/app/application/frame/stages/render-stage.ts`; `packages/presentation/hud/hud-scale.ts` |
| `parity/ux/gamepad`: `unverified` | `mc-render` | W3 | S | **New** `mc-render/test/gamepad-input.test.ts`: stick, button, trigger, and bumper mappings | **New** `e2e/gamepad.e2e.ts`: exercise mappings with a Gamepad API stub | `packages/presentation/input/gamepad-input-state.ts` |
| `parity/ux/onboarding`: `unverified` | `mx-ui` | W4 | S | **New** `mx-ui/test/onboarding.test.ts`: persist dismissal of Quick Controls and open How to Play | **New** `e2e/onboarding.e2e.ts`: verify first-run hint and dismissal | `packages/presentation/hud/controls-hint.ts`; `packages/presentation/menu/pause-menu.ts` |
| `parity/ux/graphics-presets-adaptive`: `unverified` | `mc-render` | W3 | M | **New** `mc-render/test/graphics-quality.test.ts`: map presets to passes and downgrade after sustained overrun | **Existing** `e2e/performance-budget.e2e.ts`; `e2e/shader-probe.e2e.ts` | `packages/app/application/frame/frame-adaptive-quality.ts`; `packages/game/application/settings.schema.ts` |
| `parity/ux/f3-overlay`: `unverified` | `mx-ui` | W4 | M | **New** `mx-ui/test/debug-overlay.test.ts`: toggle panel and update position, biome, and chunk metrics | **New** `e2e/debug-overlay.e2e.ts`: toggle and inspect debug metrics | `packages/presentation/hud/debug-overlay-runtime.ts` |
| `parity/ux/screenshot-key`: `unverified` | `mc-render` | W3 | S | **New** `mc-render/test/screenshot-key.test.ts`: key press downloads a canvas PNG | **New** `e2e/screenshot-key.e2e.ts`: capture and inspect the downloaded image | `packages/presentation/hud/screenshot-key.ts` |
| `parity/ux/pause-settings-savequit`: `partial` | `mx-ui` | W4 | S | **New** `mx-ui/test/pause-menu.test.ts`: Escape, settings modal, save-quit, and repeated-session load | **Existing** `e2e/escape-priority.e2e.ts`; `e2e/session-lifecycle.e2e.ts` | `packages/presentation/menu/pause-menu.ts` |
| `parity/ux/colorblind`: `unverified` | `mx-ui` | W4 | S | **New** `mx-ui/test/color-vision.test.ts`: mode values, persisted setting, and canvas filter attribute | **Existing** `e2e/player-settings.e2e.ts`: select mode and verify filter attribute | `packages/presentation/hud/color-vision.ts` |
| `parity/ux/captions`: `implemented` | `mc-audio` | W2 | S | **Existing** `mc-audio/test/caption-gate.test.ts`; `mc-audio/test/music-and-captions.test.ts`: captions remain available with muted audio | **Existing** `e2e/survival-combat.e2e.ts`: damage caption | Not required |
| `parity/ux/fov-celebration`: `unverified` | `mx-ui` | W4 | L | **New** `mc-sim/test/achievement-service.test.ts`; `mc-render/test/fov-setting.test.ts`; `mx-ui/test/achievement-toast.test.ts`: unlock/persist, apply 30 to 110° FOV, and expose accessible toast | **Existing** `e2e/player-settings.e2e.ts`; **new** `e2e/achievement-toast.e2e.ts` | `packages/game/application/settings.schema.ts`; `packages/app/application/frame/stages/camera-stage.ts`; `packages/entity/application/achievement-service.ts`; `packages/presentation/hud/achievement-toast.ts` |
| `parity/gap/modding`: `partial` | `mc-kernel` | W5 | S | **New** `mc-kernel/test/custom-recipe-schema.test.ts`: validate recipe-pack schema, reject invalid entries, and detect ID collisions | **New** `e2e/custom-recipes.e2e.ts`: load local custom recipes into the recipe book | `packages/inventory/domain/custom-recipes.ts` |
| `parity/gap/boats`: `partial` (known-gap addendum) | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/vehicle-motion.test.ts`; **new** `mx-gameplay/test/parked-boat.test.ts`: free-floating entity lifecycle | **Existing** `e2e/boat-water.e2e.ts`: extend unmounted and parked behavior | Not required |
| `parity/gap/minecarts`: `partial` (known-gap addendum) | `mx-gameplay` | W4 | M | **Existing** `mx-gameplay/test/vehicle-rail-simulation.test.ts`; **new** `mx-gameplay/test/powered-rail-braking.test.ts`: unpowered braking and powered boost | **Existing** `e2e/minecart-corners.e2e.ts`: extend powered-rail checks | `packages/game/domain/rail-shape.ts`; `packages/app/application/frame/stages/interaction-item-use-handler/minecart-mount.ts` |
| `parity/gap/ocean-depth`: `unverified` | `mc-worldgen` + `mx-gameplay` | W4 | L | **New** `mc-worldgen/test/ocean-depth-parity.test.ts`: kelp/seagrass density and water clearance; **new** `mx-gameplay/test/guardian-extension.test.ts`: keep Guardian behavior separate as an extension | **New** `e2e/ocean-depth.e2e.ts`: assert kelp/seagrass parity separately from Guardian extension behavior | `packages/world/domain/terrain/plant-placer.ts`; `packages/entity/domain/mob/mobs/guardian.ts` |
| `parity/gap/audio-live`: `implemented` | `mc-audio` | W2 | S | **Existing** `mc-audio/test/webaudio-surface.test.ts`: WebAudio surface behavior | **Existing** `e2e/audio-runtime.e2e.ts`: startup, persisted toggle, and scheduled cues | Not required |
| `parity/extension/wither`: `implemented` (**extension**) | `mx-gameplay` | W4 | S | **Existing** `mx-gameplay/test/wither.test.ts`: boss attack, damage, and lifecycle | **Existing** `e2e/multiplayer-wither-protocol.e2e.ts`: competing damage and canonical state after rejoin | Not required |
| `parity/performance/fps-rd5`: `unverified` | `mc-render` | W6 | S | **New** `mc-render/test/performance-metrics.test.ts`: record FPS at render distance 5 / 225 meshes | **Existing** `e2e/performance-budget.e2e.ts`: measure RD5 against reference observation | Not required |
| `parity/performance/fps-rd8`: `unverified` | `mc-render` | W6 | S | **New** `mc-render/test/performance-metrics.test.ts`: record FPS at render distance 8 / 289 meshes | **Existing** `e2e/performance-budget.e2e.ts`: measure RD8 against reference observation | Not required |
| `parity/performance/frustum-cull-ratio`: `unverified` | `mc-render` | W6 | S | **New** `mc-render/test/frustum-culling.test.ts`: compute culled-to-loaded mesh ratio | **Existing** `e2e/performance-budget.e2e.ts`: record host cull ratio | Not required |
| `parity/performance/teleport-readiness`: `unverified` | `mc-worldgen` | W6 | S | **New** `mc-worldgen/test/teleport-readiness.test.ts`: measure readiness after a 200-block teleport | **New** `e2e/teleport-readiness.e2e.ts`: record time to a complete visible ring | Not required |
| `parity/performance/test-suite-count`: `unverified` | `mc-compose` | W6 | S | **New** `mc-compose/test/parity-suite-count.test.ts`: report unit-test pass count, unit-test file count, and E2E pass count; do not gate on equality across projects | N/A: runner reports are inventory metrics, not browser behavior | Reference reports 9,287 unit tests passing across 808 files and 64 E2E tests passing |
| `perf/fr-0.1`: `unverified` | `mc-render` | W3 | M | **New** `mc-render/test/gpu-timer-service.test.ts`: timer-query result and unsupported-extension fallback | **Existing** `e2e/shader-probe.e2e.ts`: timer-query probe and fallback | `phase/04-performance-requirements.md` §FR-0.1; `packages/rendering/infrastructure/perf/gpu-timer-service.ts` |
| `perf/fr-0.2`: `unverified` | `mc-render` | W3 | S | **New** `mc-render/test/perf-marks.test.ts`: per-stage marks and durations | **Existing** `e2e/performance-budget.e2e.ts`: inspect stage timing entries | `phase/04-performance-requirements.md` §FR-0.2; `packages/rendering/infrastructure/perf/perf-marks.ts` |
| `perf/fr-0.3`: `unverified` | `mc-compose` | W5 | S | **New** `mc-compose/test/performance-budget.test.ts`: threshold result from FPS samples | **Existing** `e2e/performance-budget.e2e.ts`: headless FPS threshold gate | `phase/04-performance-requirements.md` §FR-0.3; `e2e/` |
| `perf/fr-1.1`: `unverified` | `mc-compose` | W5 | S | **New** `mc-compose/test/frame-stage-cancellation.test.ts`: cancelling one stage prevents later stages | N/A: deterministic frame-stage orchestration is covered by the package contract | `phase/04-performance-requirements.md` §FR-1.1; `packages/app/application/frame/stages/` |
| `perf/fr-1.2`: `unverified` | `mc-render` | W3 | M | **New** `mc-render/test/adaptive-quality.test.ts`: sustained overrun downgrades one preset | **Existing** `e2e/performance-budget.e2e.ts`: verify runtime downgrade | `phase/04-performance-requirements.md` §FR-1.2; `packages/app/application/frame/frame-maintenance.ts` |
| `perf/fr-1.3`: `implemented` | `mc-physics` | W2 | S | **Existing** `mc-physics/test/integrate.test.ts`: fixed-step integration and 0.05-second delta cap | N/A: numeric integration contract is asserted at package level | `phase/04-performance-requirements.md` §FR-1.3; `packages/game/application/game-loop/index.ts` |
| `perf/fr-1.4`: `unverified` | `mc-compose` | W5 | S | **New** `mc-compose/test/autosave-schedule.test.ts`: daemon lifecycle and five-second cadence | **Existing** `e2e/persistence.e2e.ts`: autosaved world survives reload | `phase/04-performance-requirements.md` §FR-1.4; `src/main.ts` |
| `perf/fr-2.1`: `unverified` | `mc-worldgen` | W3 | M | **New** `mc-worldgen/test/chunk-store-lru.test.ts`: access updates LRU order and eviction removes the least-recently-used chunk | N/A: deterministic cache eviction is a package contract | `phase/04-performance-requirements.md` §FR-2.1; `packages/world/test/chunk-manager-ops-lru.test.ts` |
| `perf/fr-2.2`: `unverified` | `mc-worldgen` | W3 | S | **New** `mc-worldgen/test/chunk-load-concurrency.test.ts`: cap concurrent loads at four | N/A: load concurrency is measured at the package boundary | `phase/04-performance-requirements.md` §FR-2.2; `packages/world/application/chunk-manager-service.ts` |
| `perf/fr-2.3`: `implemented` | `mc-save` | W2 | S | **Existing** `mc-save/test/indexeddb-storage.test.ts`: IndexedDB round-trip | **Existing** `e2e/persistence.e2e.ts`: autosaved world reloads | `phase/04-performance-requirements.md` §FR-2.3; `packages/world/infrastructure/` |
| `perf/fr-2.4`: `unverified` | `mc-worldgen` | W3 | S | **New** `mc-worldgen/test/lake-generator.test.ts`: same seed produces the same lake | N/A: seed determinism is a generator contract | `phase/04-performance-requirements.md` §FR-2.4; `packages/world/domain/terrain/lake-generator.ts` |
| `perf/fr-3.1`: `unverified` | `mc-meshing` | W2 | M | **New** `mc-meshing/test/lod-ratios.test.ts`: three distance levels meet vertex-ratio ranges | **New** `e2e/lod-distance.e2e.ts`: distance changes the selected host LOD | `phase/04-performance-requirements.md` §FR-3.1; `packages/rendering/infrastructure/meshing/lod-simplification.ts` |
| `perf/fr-3.2`: `unverified` | `mc-meshing` | W2 | S | **New** `mc-meshing/test/lod-fluid-exclusion.test.ts`: water and fluid remain at LOD 0 | **New** `e2e/lod-distance.e2e.ts`: fluid remains full detail at distance | `phase/04-performance-requirements.md` §FR-3.2; `packages/rendering/infrastructure/meshing/lod-simplification.ts` |
| `perf/fr-3.3`: `implemented` | `mc-meshing` | W2 | S | **Existing** `mc-meshing/test/mesh-greedy.test.ts`; `mc-meshing/test/fluid-mesh.test.ts`: opaque and water sub-meshes | N/A: mesh output contract is covered by package tests | `phase/04-performance-requirements.md` §FR-3.3; `packages/rendering/infrastructure/meshing/greedy-meshing.ts` |
| `perf/fr-3.4`: `unverified` | `mc-meshing` | W2 | S | **New** `mc-meshing/test/greedy-meshing-ao.test.ts`: six directional passes share AO computation | N/A: shared AO is a package meshing contract | `phase/04-performance-requirements.md` §FR-3.4; `packages/rendering/infrastructure/meshing/greedy-meshing-ao.ts`; `packages/rendering/infrastructure/meshing/greedy-meshing-passes.ts` |
| `perf/fr-3.5`: `implemented` | `mc-worldgen` | W3 | S | **Existing** `mc-worldgen/test/light.test.ts`: cardinal-neighbor boundary changes are reported | N/A: light propagation is tested at package level | `phase/04-performance-requirements.md` §FR-3.5; `packages/world/application/light-engine-service.ts` |
| `perf/fr-4.1`: `unverified` | `mc-meshing` | W2 | M | **New** `mc-meshing/test/subregion-greedy.test.ts`: dirty AABB entry remeshes only the requested region | N/A: sub-region mesh API behavior is a package contract | `phase/04-performance-requirements.md` §FR-4.1; `packages/rendering/infrastructure/meshing/subregion-greedy.ts`; `packages/rendering/infrastructure/meshing/meshing-worker-pool.ts` |
| `perf/fr-4.2`: `unverified` | `mc-worldgen` | W3 | M | **New** `mc-worldgen/test/chunk-aabb-queue.test.ts`: per-chunk dirty bounds accumulate and drain | N/A: queue behavior is verified at the package boundary | `phase/04-performance-requirements.md` §FR-4.2; `packages/world/domain/chunk-aabb.ts`; `packages/app/application/frame/frame-maintenance.ts`; `packages/app/application/frame/interaction-block-handler.ts` |
| `perf/fr-4.3`: `partial` | `mc-render` | W3 | M | **New** `mc-render/test/composite-pass.test.ts`: effects share one program and presets gate the pass | **Existing** `e2e/shader-probe.e2e.ts`: composite shader and preset configuration | `phase/04-performance-requirements.md` §FR-4.3; `packages/rendering/infrastructure/post-processing/composite-pass.ts` |
| `perf/fr-4.4`: `unverified` | `mc-render` | W3 | S | **New** `mc-render/test/refraction-ratio-gate.test.ts`: below-threshold water ratio skips refraction | **Existing** `e2e/shader-probe.e2e.ts`: verify the rendered refraction gate | `phase/04-performance-requirements.md` §FR-4.4; `packages/rendering/infrastructure/post-processing/post-processing-stage.ts` |
| `perf/fr-4.5`: `deferred` | `mc-render` | W3 | L | **New** `mc-render/test/ssim-adaptive-quality.test.ts`: compare active composer output with a reference render in a hidden render target; sustained SSIM below 0.95 triggers a one-preset downgrade | **New** `e2e/ssim-adaptive-quality.e2e.ts`: verify the runtime gate lowers the host preset after sustained SSIM below 0.95 | `phase/04-performance-requirements.md` §FR-4.5; `packages/rendering/test/composite-pass.test.ts` is build-time evidence only |
| `perf/fr-4.6`: `deferred` | `mc-render` | W6 | L | **New** `mc-render/test/meshing-slice-cache.test.ts`: dirty bounds invalidate intersecting slices across frames while preserving output | **New** `e2e/mesh-slice-cache.e2e.ts`: edited region updates while unaffected cached slices persist | `phase/04-performance-requirements.md` §FR-4.6; `packages/rendering/infrastructure/meshing/subregion-greedy.ts`; `packages/rendering/infrastructure/meshing/meshing-worker.ts` |

## Vanilla reference crosswalk

Each row below is one of the 54 rows in `takeokunn/ts-minecraft:docs/reference/vanilla-parity.md`. Extension-only work is never counted as a vanilla implementation.

| Reference row | Vanilla feature | Ledger mapping | Count treatment |
|---|---|---|---|
| S1 | Movement | `parity/survival/movement` | Parity |
| S2 | Mining | `parity/survival/mining` | Parity |
| S3 | Block placement | `parity/survival/placement` | Parity |
| S4 | Drops | `parity/survival/drops` | Parity |
| S5 | Hunger | `parity/survival/hunger` | Parity |
| S6 | Health, fall damage, regeneration | `parity/survival/health-fall-regen` | Parity |
| S7 | Death and respawn | `parity/survival/death-respawn` | Parity |
| S8 | Save and load | `parity/survival/save-load` | Parity |
| S9 | Day/night cycle | `parity/survival/day-night` | Parity |
| S10 | Experience | `parity/survival/xp` | Parity |
| C1 | 2×2 inventory crafting | `parity/crafting/grid-2x2` | Parity |
| C2 | 3×3 shaped crafting | `parity/crafting/grid-3x3` | Parity |
| C3 | Furnace | `parity/crafting/furnace` | Parity |
| C4 | Chest storage | `parity/crafting/chest` | Parity |
| C5 | Brewing stand | `parity/crafting/brewing` | Parity |
| C6 | Anvil | `parity/crafting/anvil` | Parity |
| C7 | Enchanting table | `parity/crafting/enchanting-table` | Parity |
| B1 | Melee combat | `parity/combat/melee` | Parity |
| B2 | Bow | `parity/combat/bow` | Parity |
| B3 | Armor | `parity/combat/armor` | Parity |
| B4 | Shield blocking | `parity/combat/shield` | Parity |
| B5 | Status effects | `parity/combat/status-effects` | Parity |
| B6 | Hit feedback | `parity/combat/hit-feedback` | Parity |
| W1 | Terrain and biomes | `parity/worldgen/terrain-biomes` | Parity |
| W2 | Caves, ravines, ores, gravel, and flint | `parity/worldgen/caves-ores` | Parity |
| W3 | Trees, crops/farming, and animals | `parity/worldgen/trees-farming`; `parity/worldgen/passive-animals` | Parity; split across two ledger rows |
| W4 | Villages, villagers, and trading | `parity/worldgen/villages` | Parity |
| W5 | Structures | `parity/worldgen/structures` | Parity |
| W6 | Nether | `parity/worldgen/nether` | Parity |
| W7 | The End and dragon | `parity/worldgen/end-dragon` | Parity |
| W8 | Weather | `parity/worldgen/weather` | Parity |
| W9 | Sleep | `parity/worldgen/sleep` | Parity |
| R1 | Wire, torch, lever, button, pressure plate, and lamp | `parity/redstone/basic-components` | Parity |
| R2 | Repeater | `parity/redstone/repeater` | Parity |
| R3 | Piston | `parity/redstone/piston` | Parity |
| R4 | Observer | `parity/redstone/observer` | Parity |
| R5 | Hopper | `parity/redstone/hopper` | Parity |
| R6 | Comparator | `parity/redstone/comparator` | Parity |
| R7 | Dispenser | `parity/redstone/dispenser` | Parity |
| M1 | Seed handshake, world adoption, and block-edit replay on join | `parity/multiplayer/seed-handshake` | Parity |
| M2 | Entity host authority, reassignment on leave, and ghost cleanup | `parity/multiplayer/entity-authority` | Parity; host-authority behavior only |
| M3 | Player, time-of-day, explosion, and portal sync | `parity/multiplayer/player-time-sync` | Parity; explosion/portal transport mapping unresolved |
| M4 | Reconnect binding (`isSelf` echo) | `parity/multiplayer/reconnect-binding` | Parity |
| M5 | Dedicated-server scale, anti-cheat, and chunk-delta compression (`❌` known gap) | `parity/multiplayer/dedicated-server` (extension tracking only) | No vanilla parity implementation; extension excluded |
| U1 | Difficulty selector | `parity/ux/difficulty-selector` | Parity; implementation work remains despite ledger status |
| U2 | Key remapping | `parity/ux/key-remapping` | Parity |
| U3 | Reduced motion and UI scale | `parity/ux/reduced-motion-ui-scale` | Parity |
| U4 | Gamepad | `parity/ux/gamepad` | Parity |
| U5 | Onboarding hints and How to Play | `parity/ux/onboarding` | Parity |
| U6 | Graphics presets, pass toggles, and adaptive quality | `parity/ux/graphics-presets-adaptive` | Parity |
| U7 | F3 overlay, screenshot key, and pause/settings/save-quit flow | `parity/ux/f3-overlay`; `parity/ux/screenshot-key`; `parity/ux/pause-settings-savequit` | Parity; split across three ledger rows |
| U8 | Colorblind correction | `parity/ux/colorblind` | Parity |
| U9 | Sound-cue captions | `parity/ux/captions` | Parity |
| U10 | FOV, level-up, and achievement cues | `parity/ux/fov-celebration` | Parity |

## Extension and open-scope notes

- `carrot`, `beetroot`, touch controls, Wither, and server-authoritative multiplayer are extensions. Exclude them from vanilla parity counts. In `parity/worldgen/trees-farming`, test only reference-listed crops; in `parity/worldgen/passive-animals`, implement only the reference mob behavior. Guardian, amethyst, and deepslate are extension scope. `parity/gap/ocean-depth` remains a ledger row with a partial reference status, not an extension row. `parity/extension/wither` and `parity/multiplayer/dedicated-server` are explicitly extensions.
- The data-driven custom recipe pack is reference-backed; scripting/plugin APIs remain an extension under `parity/gap/modding`.
- The ledger marks difficulty as `implemented`, but the host hard-codes `'normal'`; implement the selector and persistence. Gamepad remains `unverified` and has no host adapter wiring. The current settings model lacks difficulty, reduced-motion, UI scale, color correction, FOV, and graphics presets. Treat these as unfinished implementation across U1, U3, U6, U8, and U10; preserve the source ledger statuses in the status count.
- For M2, parity means observable entity-host handoff and ghost cleanup. Server-authoritative multiplayer architecture is an extension. In M3's reference repository, `packages/network/domain/schemas.ts` has no named explosion or portal message, and `packages/app/application/multiplayer/multiplayer-inbound.ts` has no corresponding inbound handler. The owner is `mx-multiplayer`, but those event mappings remain unresolved; do not claim their parity until the transport path is located.
- `perf/fr-4.5` and `perf/fr-4.6` keep their ledger `deferred` statuses, but both are scheduled implementation work. FR-4.5 is assigned to W3 with adaptive quality; FR-4.6 is assigned to W6 as final cross-frame cache work.
- Sizes and waves are assignments, not source ledger fields. W2 through W6 totals below count each of the 98 ledger IDs once, including extension and addendum rows.

| Ledger status | Rows |
|---|---:|
| `implemented` | 39 |
| `partial` | 16 |
| `unverified` | 39 |
| `unimplemented` | 2 |
| `deferred` | 2 |
| **Total** | **98** |

| Wave | Rows |
|---|---:|
| W2 | 14 |
| W3 | 30 |
| W4 | 44 |
| W5 | 4 |
| W6 | 6 |
| **Total** | **98** |
