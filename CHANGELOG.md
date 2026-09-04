# @nerima-games/mc-compose

## 0.2.7

### Patch Changes

- [#48](https://github.com/nerima-games/mc-compose/pull/48) [`c32c1df`](https://github.com/nerima-games/mc-compose/commit/c32c1df64dee7716b06efc5dc8b6aa1316d61105) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix `gameplay.seedRedstoneFixtures` silently placing nothing when the player has traveled far away first, which a chained QA session read as "input goes dead" in a long session.
  
  A full-loop QA pass reported real clicks going dead on interactions that worked fine in isolation — a redstone button press among them — with which interaction failed varying between runs. Investigating the redstone case with instrumentation (real DOM event counts, `document.pointerLockElement` state, retrying the identical click) ruled out the pointer-lock/focus theory entirely: the click event reached the page, the pointer lock spoof stayed intact, and a second identical click behaved the same as the first. The input path was never the problem.
  
  The actual cause was upstream of input: unlike every sibling `seed*Encounter` fixture in `apps/web/main.ts` (`seedBoatWaterEncounter`, `seedPortalEncounter`, `seedRailTrackEncounter`, ...), `seedRedstoneFixtures` never called `streamAround` for its own coordinates before writing blocks there. It assumed the area stays streamed in because it sits near spawn. A chained session that visits another fixture first (or a real player who simply wanders that far and comes back) evicts the area from `streamLoaded`, and `currentChunkStore.setBlock` on an unloaded chunk is a silent no-op — every fixture block fails to place, `redstoneFixturesSnapshot` reads back nulls, and a real click on the never-placed button has nothing to act on. Frames keep advancing normally throughout, which is why it reads as "the click had no effect" rather than a hang.
  
  `e2e/redstone-components.e2e.ts` pins the fix: seed the fixtures, travel far away (`gameplay.seedPortalEncounter`), reseed, and confirm a real click still lights the lamp.

## 0.2.6

### Patch Changes

- [#46](https://github.com/nerima-games/mc-compose/pull/46) [`3bdfcfd`](https://github.com/nerima-games/mc-compose/commit/3bdfcfdd30aa17b81191d4c64a3237fe19465633) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix a boat placed on water not actually floating in it, so holding forward left it crawling in place instead of sailing.
  
  A live QA pass drove a boat as far as the surface allows — crafted, placed by a real right-click (a boat entity genuinely appeared), and mounted (the player's pose snapped onto it) — but could only test propulsion on a dry stone floor, the only terrain the QA fixtures offered without new work, and reported "could not test on water" rather than a defect.
  
  `gameplay.seedBoatWaterEncounter` closes that gap: it terraforms an open-water pool and equips the boat item, but deliberately leaves placement, boarding, and driving as real actions, so a browser test exercises the same `targetedBlock()` raycast placement, boarding-distance check, and `vehicleService`/frame stage (`gameplayStages`) production play uses.
  
  That test found a real defect: a boat is placed at `target.adjacentPosition`, the empty cell next to whichever face of the target block was hit. Aiming down at open water — the common way to place a boat on it — hits the water block's TOP face, so the boat lands one cell ABOVE the water, not in it. mx-gameplay's `vehicle-frame.ts` only recognizes "in water" by reading the boat's own cell (and the one above it), so a boat placed this way was never detected as being in water and only ever received `stepBoat`'s 15% off-water crawl acceleration — regardless of how long or hard forward was held. The same bug existed in the multiplayer server's authoritative placement handling.
  
  Fixed the same way a minecart already lands on the rail's own cell rather than beside it: a boat placed by targeting water now lands in the water's own cell. `e2e/boat-water.e2e.ts` pins the fix — placement lands in the water cell, forward input reaches a peak speed within the same order of magnitude as vanilla's ~1.8 blocks/sec cruise (measured ~1.87), and steering turns the boat's heading.

## 0.2.5

### Patch Changes

- [#44](https://github.com/nerima-games/mc-compose/pull/44) [`a4b83cd`](https://github.com/nerima-games/mc-compose/commit/a4b83cdc3b5cacb226b76fc80ef22670bfec4881) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix stepping through a working Nether portal sometimes leaving the player stuck, embedded in solid terrain with nothing to stand on and no ability to move.
  
  `resolveNetherTravel`'s scaled destination is pure arithmetic with no knowledge of what actually occupies that cell, and the crossing placed the player there directly. On terrain that happened to be solid at the destination, the player arrived already overlapping rock rather than falling or walking into it — and mc-physics's collision resolver only pushes a body out of a boundary it crosses during a step, not one it started the frame already inside of, so nothing ever corrected it. The symptom matched a hostile-spawn defect fixed earlier the same way: not grounded, not falling, blocked in every direction, indefinitely.
  
  A Nether crossing now searches the arrival column for the nearest clear, supported spot before settling there, matching the destination exactly whenever it was already safe. Only when no safe spot exists anywhere in the search range does it carve one at the exact arithmetic destination, so a correction never lands anywhere but at or very near where the portal math already pointed.

## 0.2.4

### Patch Changes

- [#41](https://github.com/nerima-games/mc-compose/pull/41) [`e99e3c4`](https://github.com/nerima-games/mc-compose/commit/e99e3c4457d65ce9764e04d4cadf820f8e1ccf09) Thanks [@takeokunn](https://github.com/takeokunn)! - Add browser-level proof that a minecart turns rail corners, and fix vehicle persistence
  
  Today's mx-gameplay fix taught the rail-shape rule to steer a minecart through a 90-degree
  corner instead of running it off the end of the track. That fix had proof at the package
  level — a closed-rectangle regression test driven through mx-gameplay's own stepping path —
  but nothing reachable from the running game: the only production path that spawns a minecart
  is a real right-click against a rail block, and a fresh survival session's starter kit holds
  neither a minecart nor rail (both are craftable only through a full mining-and-smelting
  chain). Nobody driving the game by hand, and no browser test, could ever see the fix work.
  
  `gameplay.seedRailTrackEncounter` closes that gap. It seeds a closed rectangular powered-rail
  loop and spawns a minecart on it through the same `vehicleService` and frame stage
  (`gameplayStages`) production play uses — not a hand-stepped position — so the cart's motion
  afterward is the real simulation turning the corners. `gameplay.railTrackSnapshot` reports the
  cart's live position and velocity. A new e2e spec, `e2e/minecart-corners.e2e.ts`, drives this
  through a real browser and asserts the cart reaches cells on both axes of the loop while never
  once landing outside the set of rail cells — the second half is what actually falsifies the
  original bug, since the pre-fix cart ran straight off the track at a corner instead of turning.
  
  Building the fixture also surfaced a real, previously unreachable defect: an unoccupied
  vehicle's `occupant` field is `undefined` rather than an absent key, and
  `PersistedVehiclesSchema` never stripped that key the way this file's other optional session
  fields do, so the very first autosave after any vehicle existed in a session failed to encode
  ("save contains an unsupported value: undefined"). Nothing before this fixture ever put a
  vehicle through session persistence at all, so the gap was invisible. Fixed at the one place a
  `Vehicle` enters the persisted snapshot, mirroring how vehicle-motion.ts's own
  `withoutOccupant` already represents "no occupant" everywhere else.

## 0.2.3

### Patch Changes

- [#39](https://github.com/nerima-games/mc-compose/pull/39) [`2bb0820`](https://github.com/nerima-games/mc-compose/commit/2bb08204c7ce217cc03bc0addfe1d61036d6d775) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix the QA hostile-spawn fixture so a full-health enderman or blaze can actually be fought.
  
  `gameplay.spawnFullHealthEnderman` and `gameplay.spawnFullHealthBlaze` repositioned the player
  with no ground underneath, so the player fell out of melee and bow range within a fraction of a
  second of the mob appearing. The spawned mob also carried no initial behaviour, so an enderman
  never teleported — it just stood there inert, indistinguishable from a passive mob. Both QA
  commands now leave the player standing on solid ground next to a mob that behaves like every
  other hostile spawn.

## 0.2.2

### Patch Changes

- [#37](https://github.com/nerima-games/mc-compose/pull/37) [`b2542f4`](https://github.com/nerima-games/mc-compose/commit/b2542f44b70f1fa59f6be4a9741a165346dbcc62) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix the save-status indicator getting stuck on "unsaved" while the player keeps moving
  
  A player who kept drifting — most visibly floating passively in water at spawn, with no
  input held — could see the save indicator stay on "unsaved" indefinitely, even though saves
  were actually succeeding underneath and nothing was ever lost. Reloading always restored the
  latest state correctly; only the on-screen indicator was wrong.
  
  The indicator flipped to "saved" only when the generation a save had just finished covering
  matched whatever the *live, still-changing* generation counter read at that instant. Every
  frame of movement mints a new generation, so under continuous drift the live counter had
  almost always ticked forward again by the time a save's own round trip completed, and the
  comparison could go an unbounded time without ever holding.
  
  The fix compares against the generation captured at the moment a save cycle was requested,
  not the generation read back later when it finishes. Once that request's own target is
  covered, the indicator can honestly say "saved" for it — any newer change is already flagged
  "unsaved" through the normal path the moment it happens, and the next save cycle (debounce or
  the 5-second autosave) picks it up in turn. A player floating in place now sees the indicator
  reach "saved" on each autosave, instead of never.
  
  Confirmed in both directions against a real running session: with the previous comparison,
  16 seconds of continuous water drift produced zero "saved" transitions; with this fix, the
  same drift produces one roughly every 5 seconds (the autosave interval), and an explicit save
  on solid ground still reaches "saved" immediately as before.

## 0.2.1

### Patch Changes

- [#35](https://github.com/nerima-games/mc-compose/pull/35) [`29d63f8`](https://github.com/nerima-games/mc-compose/commit/29d63f832897a21d704bed68f85f32250149383e) Thanks [@takeokunn](https://github.com/takeokunn)! - Advance the kernel pin so footsteps are audible across the world.
  
  The block registry previously carried a footstep material for fifteen of its
  blocks and left the rest on the default, which the audio package maps to no cue
  at all — so a player walking over most terrain, deepslate included, heard
  nothing underfoot. The kernel release this pin picks up covers ninety-two more
  blocks using the existing four-value vocabulary.
  
  The data lives in the kernel, so this pin is what actually reaches a player;
  until it lands the shipped game stays silent regardless of the upstream fix.

## 0.2.0

### Minor Changes

- [#20](https://github.com/nerima-games/mc-compose/pull/20) [`f8bf249`](https://github.com/nerima-games/mc-compose/commit/f8bf2499e089ce64b045c4bc90cff3df3d3a4c24) Thanks [@takeokunn](https://github.com/takeokunn)! - Bring every internal dependency onto its current published version and fix the drift that forces
  
  The twelve packages move together: mc-audio 0.2.8, mc-kernel 0.7.0, mc-physics 0.2.2,
  mc-playground-kit 0.3.1, mc-render 0.5.2, mc-save 0.4.1, mc-sim 0.4.2, mc-worldgen 0.3.2,
  mx-gameplay 0.5.2, mx-multiplayer 0.8.2, mx-redstone 0.3.2 and mx-ui 0.5.2.
  
  The kernel's branded block position, block id and chunk coordinate types now thread through
  every chunk-store call site, and the widened multiplayer message union is handled explicitly
  everywhere this application still speaks its own local wire format.
  
  One real defect is fixed. Enderman teleport never happened: this application built its own list
  of candidate cells from a locally reimplemented offset formula, while the gameplay package
  derives its own candidates internally, so no sampled cell ever matched, every candidate read as
  absent from the loaded snapshot, and the resolver returned the input position unchanged. Every
  hurt enderman silently stayed where it was. It now asks the gameplay package for the positions
  it will actually query, and the local reimplementation is gone.
  
  Block types in the redstone scanner and the QA fixture seeders are now referenced by name
  rather than by numeric literal. This changes no behaviour — the literals resolved to the same
  blocks — but a name cannot drift the way a bare number can if the registry is ever reordered.
  
  The redstone component test now asserts on the recorded lamp transition rather than polling
  live block state. An observer pulses for two redstone ticks, so the lit state is transient by
  design and a poll running across browser round trips can step over it entirely while the
  circuit works perfectly. The transition record is durable, so it cannot be missed; a second
  assertion confirms the lit block id actually landed, keeping "the event fired" and "the write
  landed" as separate claims. The test was previously failing about half of all full-suite runs
  under load and now passes consistently.

### Patch Changes

- [#21](https://github.com/nerima-games/mc-compose/pull/21) [`bf3c13b`](https://github.com/nerima-games/mc-compose/commit/bf3c13b532f2dfdaa06982478b0e84c314c03fb8) Thanks [@takeokunn](https://github.com/takeokunn)! - Un-park the bow projectile test and add a regression guard for the draw-charge clamp
  
  Bow draw duration is measured in real elapsed time while physics stays on the clamped
  per-frame delta, and that was already correct in the code — but nothing explained why, and
  nothing would have caught it going wrong.
  
  The distinction matters and is now documented at the call site: the clamp exists so a stalled
  tab resumes in slow motion rather than teleporting through one enormous step, which is right
  for a physics integration and wrong for the duration of a player's input. How long someone
  held a button is a wall-clock fact that does not become less true because the renderer stalled.
  Folding the two back together silently discards genuinely long bow holds on slow hardware.
  
  The parked test is un-parked; its comment described a defect that had already been fixed, and
  cited line numbers that had since moved.
  
  A second test guards the distinction. It forces every real frame to cost well past the clamp,
  then holds the bow for a duration that cannot accumulate enough clamped time to fire but is
  comfortably long in real time. Its margin is structural rather than arithmetic — the stall is
  long enough that too few frames can fit inside the hold for the clamped path to reach the
  threshold under any scheduling — because an earlier version of the same test sat exactly on
  that threshold and passed against deliberately broken code. The comment records that near miss
  so the numbers are not tuned back toward the boundary.
  
  Validated in both directions on isolated ports: it fails against the reverted implementation
  and passes against the current one.

- [#21](https://github.com/nerima-games/mc-compose/pull/21) [`bf3c13b`](https://github.com/nerima-games/mc-compose/commit/bf3c13b532f2dfdaa06982478b0e84c314c03fb8) Thanks [@takeokunn](https://github.com/takeokunn)! - Verify the bow shot against the game physics rather than a fixed landing box
  
  The projectile test asserted an absolute landing position, which only holds for the charge it
  meant to produce — and it produced that charge by holding a button for a wall-clock duration
  across a latency-bound channel, so on a slow runner the hold ran long, the shot overcharged, and
  the arrow overshot the box. Imprecise input, precise assertion.
  
  It now checks the flight against the game own physics instead. Two snapshots of the same
  projectile in flight are observed, and the same integration functions the application calls are
  replayed forward between them for the elapsed simulated time actually reported. The test never
  needs to know what charge was achieved, so the timing imprecision has nothing to act on.
  
  The projectile snapshot gains the launch velocity, which the record already carried and simply
  did not expose.
  
  The tolerance is measured rather than chosen. A derivation from step-schedule sensitivity alone
  predicts near zero, yet repeated runs against known-good code show a consistent small gap: a fast
  arrow crosses the target face in well under a millisecond, so tiny differences in when that
  crossing registers scale by impact speed. The floor is the measured maximum doubled, and the
  command that reproduces the measurement is recorded beside it.
  
  Validated in both directions. Substituting a different gravity profile makes it fail reliably,
  by a margin well outside tolerance. Doubling the integration step does NOT make it fail, because
  flight time is taken from the reported simulated age, which inflates in step — so this test
  covers integration fidelity for a given amount of simulated time, and the sibling stall-injection
  test covers the rate at which simulated time advances. Each one names what it does not see.

- [#27](https://github.com/nerima-games/mc-compose/pull/27) [`9b282b6`](https://github.com/nerima-games/mc-compose/commit/9b282b6d4be854d02e5fdb0943cfe93e87e8eecd) Thanks [@takeokunn](https://github.com/takeokunn)! - Place the floor block under every QA fixture that restores the shared spawn pose
  
  A fixture that puts the player at a pose without placing the block that pose stands on leaves
  them falling through unset terrain for the whole encounter, and a right-click raycast from a
  continuously dropping eye height misses whatever it was aimed at.
  
  That defect has now been found three times, in three separate investigations, and each time it
  was first attributed to something else — input delivery, processor contention, a synthetic
  pointer lock. It is invisible as a pattern precisely because the fixtures that do place the block
  keep working, so each failure looks unrelated to the last.
  
  So this closes it as a class rather than as instances. Every call site restoring that pose was
  audited: eight already placed the block, nine did not, and all nine now do. Counting the
  placements against the restores confirms one for one, with none left.
  
  Nine includes fixtures no current test right-clicks through. A fixture that drops the player is
  wrong whether or not today's assertions happen to notice, and "nothing raycasts through this one"
  is a claim with an expiry date.

- [#25](https://github.com/nerima-games/mc-compose/pull/25) [`e9bd261`](https://github.com/nerima-games/mc-compose/commit/e9bd2613545932003ff729b5fb457d18cb2d9a70) Thanks [@takeokunn](https://github.com/takeokunn)! - Express a movement threshold in game time, and stop the wait helper's diagnostic losing a race
  
  Two fixes that share a root: a quantity measured against real time when the thing it describes is
  governed by simulated time.
  
  The touch-input test waits for horizontal drift to settle, comparing the distance between
  successive samples against a floor. That floor is a speed, and it was denominated per sample —
  which only means what it should if the simulation advances at a fixed rate. On a slow host less
  ground is covered inside the same interval, so movement that is proceeding perfectly correctly
  reads as already settled, or fails to clear the bar. Preserving the original sampling cadence was
  tried first and is not sufficient, because the cadence was never the problem.
  
  It now compares distance against elapsed simulated time, using the cumulative simulation clock the
  application already publishes. The bar keeps the value its author intended, expressed as blocks
  per simulated second rather than blocks per sample, and a pair of samples too close together to
  judge is treated as undecided rather than as settled — so a vanishing denominator can never
  produce a false pass. Because the assertion no longer depends on how often it is sampled, the test
  needs no special cadence and polls at the default.
  
  Separately, the wait helper's real-time backstop defaulted to exactly the framework's own default
  test timeout, so on any test that had not raised its timeout the generic message won the race and
  hid the helper's own — the one that says whether frames were still advancing, which is the whole
  diagnostic value. An audit found seventeen of nineteen call sites in that position. Rather than
  annotate each, the default now derives from whatever timeout the test is actually running under,
  less a margin, so the useful message arrives first automatically and any future adopter inherits
  it without having to know.

- [#26](https://github.com/nerima-games/mc-compose/pull/26) [`8139f99`](https://github.com/nerima-games/mc-compose/commit/8139f99ab39f2e57a924e0b63bc417806fd04cb9) Thanks [@takeokunn](https://github.com/takeokunn)! - Place the floor block two QA fixtures were missing, and un-park four tests
  
  Two encounter fixtures restored the player to a pose without placing the block that pose stands
  on, so the player free-fell for the whole encounter and a right-click raycast, cast from an eye
  height that had dropped more than a block, missed its target entirely.
  
  That explains a symptom that never fit anything else: absent rather than delayed, never
  reproducible under processor throttling because it was never timing, and intermittent because it
  depended how far the fall had progressed when the click landed. The same defect had already been
  found and fixed once for a sibling fixture; two were missed at the time.
  
  Four tests are un-parked. Two were genuinely broken and are fixed. Two were never broken by this
  and their notes were stale — one fixture already placed the block, and the other does not use that
  pose at all.
  
  Two helpers that granted a synthetic pointer lock before moving the real cursor are reordered so
  no cursor movement follows the lock. That addresses a separate suspected hazard which could not
  be reproduced outside the integration runner, so it removes a known-unsafe ordering rather than
  fixing an observed failure.

- [#32](https://github.com/nerima-games/mc-compose/pull/32) [`d181ae6`](https://github.com/nerima-games/mc-compose/commit/d181ae6103e7015b22ba8443a89d1fe08f3fbb1f) Thanks [@takeokunn](https://github.com/takeokunn)! - Collide blocks with their real registry shape instead of a full cube
  
  `pressure-plate-real-input`'s changeset documented the limitation this closes: mc-compose's
  `simPhysicsConfig.resolve.blockPropertiesAt` returned `BLOCK_PROPERTY_DEFAULTS` — kernel's generic
  opaque-solid-cube properties — for every solid block, regardless of what that block actually is.
  mc-physics's resolver already reads `properties.collisionShape` to pick a block's real collision
  box (`resolve-shapes.ts`), and mc-kernel already carries a `collisionShape` per block in its
  registry (`full`, `slab`, `pressurePlate`, `cactus`, `none`); mc-compose just never consulted it, so
  a slab, a plate or a cactus all collided as an impassable full cube.
  
  `blockPropertiesAt` now resolves the real block at each cell via `resolvedBlockOfId` (the same
  accessor mc-physics's own `kernel-world.ts` adapter uses) and returns its actual properties. An
  unloaded chunk or an out-of-world cell still falls back to `BLOCK_PROPERTY_DEFAULTS` — collision
  must still fail closed to solid there, or the edge of the loaded world becomes a hole a player falls
  through forever.
  
  `isStandingOnCell` — the pressure-plate occupancy check — assumed a standing surface is always
  `cell.y + 1`, true only for a full cube. It now reads the same collision shape the resolver uses and
  stands on that shape's real top face, so occupancy detection keeps working once a plate is no longer
  sunk to a full block's height.
  
  A real, non-full shape alone was not enough: mc-physics's axis-sequential resolver blocks horizontal
  movement on any vertical overlap however thin, so a plate one cell above the walking surface was
  still a wall — its own test suite has a case titled exactly that, "with no step height injected, the
  same slab is a wall", and states plainly that the mechanism (`tryStepUp`, resolve-support.ts) is
  mc-physics's but the value is the host's. `simPhysicsConfig.resolve.stepHeight` was never set, so it
  defaulted to off. It's now `PLAYER_STEP_HEIGHT_M = 0.6`, the same reference value mc-physics's own
  suite uses throughout — enough to climb a plate, a slab or a carpet by walking into it, same as
  vanilla, while a full block (1.0) is still well past it and still needs a jump.
  
  The pressure-plate QA fixture (`qa-fixtures.ts`) no longer places the plate flush with the floor as
  a stand-in for this limitation; it sits on top of its own floor tile, one cell above the wire and
  lamp's floor, the way it actually sits in the game being reproduced.
  
  `environmental-contact-damage.e2e.ts`'s cactus test asserted no volume overlap between the player and
  the cactus's nominal cell — true only because the old full-cube collision stopped the player exactly
  at the cell's outer face. A cactus's real shape is inset a sixteenth on X and Z, so the collidable
  surface sits a sixteenth inside that face, and a player stopped against it now legitimately overlaps
  the nominal cell by that same sixteenth. That assertion is updated to match; the side-touch predicate
  right below it, which is what actually distinguishes contact from immersion, is unchanged and still
  passes.

- [#33](https://github.com/nerima-games/mc-compose/pull/33) [`7cb3e7f`](https://github.com/nerima-games/mc-compose/commit/7cb3e7f23015bfb07874d896431d18cd74efbb14) Thanks [@takeokunn](https://github.com/takeokunn)! - Advance six dependency pins to current releases.
  
  The two that change what a player sees: `mx-gameplay` 0.6.0, whose minecarts
  turn corners instead of running off the track's end — its rail-shape union
  gained four oriented curve values, which nothing in this app narrows
  exhaustively, so the minor lands without a code change here; and `mc-render`
  0.6.0, which adds arrow-key focus movement within a group.
  
  `mx-multiplayer` 0.11.0 carries the server-side command write-through and the
  completed four-lookup host-services shape. This app does not construct that
  value yet — the seam wiring is its own change — so the two intervening minors
  land without code changes here as well; taking them now means the seam work
  consumes a settled interface.
  
  `mx-redstone` 0.3.3, `mx-ui` 0.5.3 and `mc-save` 0.4.2 are maintenance
  advances with no consumer-visible surface change for this app.

- [#30](https://github.com/nerima-games/mc-compose/pull/30) [`76efc4e`](https://github.com/nerima-games/mc-compose/commit/76efc4e3c9cafb2576d903e30fb96f06e04a649e) Thanks [@takeokunn](https://github.com/takeokunn)! - Wire the pressure plate through real player contact, and cover it in the redstone components e2e test
  
  @nerima-games/mx-redstone's `domain/pressure-plate.ts` implements the redstone-rule half of a
  plate (how many occupants become how much signal) and deliberately does not implement the other
  half: deciding who is standing on it is entity/item work out of that package's scope by design.
  Nothing in this host filled that gap, so a placed pressure plate never actually powered anything —
  `syncRedstoneSnapshot` didn't even recognize the block, and the host had no occupancy detection to
  feed it.
  
  This adds both. `syncRedstoneSnapshot` now reads `pressure_plate` blocks into the redstone graph
  as a `pressure-plate` component, and a new per-frame check compares the player's resolved pose
  against every known plate's cell, flipping `active` and requesting a resync only on a genuine
  occupancy edge (not every frame — plates are not the common case).
  
  The redstone components e2e spec now drives this through actual WASD input rather than a QA
  teleport: the player walks onto a plate wired to a lamp, the lamp lights, the player walks off, the
  lamp goes dark. It found a second, real gap on the way — mc-compose's physics wiring collides every
  solid block as a full cube (a documented, deliberate limitation; per-shape collision is a later
  migration), so a plate one block above the walking surface is a wall a player cannot step onto by
  walking into it. The fixture places the plate flush with the floor instead, matching how the engine
  actually treats it today, and the occupancy check tests contact with a cell's top face rather than
  volume overlap, since a grounded player's feet sit at a surface, never inside a block.

- [#19](https://github.com/nerima-games/mc-compose/pull/19) [`87254b0`](https://github.com/nerima-games/mc-compose/commit/87254b098f9b401b82f09161c2ce79306e32f0b2) Thanks [@takeokunn](https://github.com/takeokunn)! - Assert the roster root candidates by shape (distinct roots), not by path spelling — the substring check was false by construction when this repository runs inside mc-dev-meta's repos/ mirror, which check:workspace does.

- [#23](https://github.com/nerima-games/mc-compose/pull/23) [`14d7332`](https://github.com/nerima-games/mc-compose/commit/14d73323554feafd9a2d39d683b55f991d8c784e) Thanks [@takeokunn](https://github.com/takeokunn)! - Route the rest of the simulation-gated waits through the progress helper
  
  The first pass fixed the four tests that had been observed failing. Those were a sample of
  whichever tests happened to be running when a load spike landed, not the set of vulnerable ones —
  and two more failed on CI immediately afterwards, neither of them on that list.
  
  So this pass classifies by the property rather than by the failure history: any wait whose
  subject is a state the simulation must advance to produce. Eleven more files qualify. A
  projectile in flight and a furnace consuming fuel look nothing alike as code; they are alike only
  in that both need ticks to accrue before the assertion can hold.
  
  Covered here: mining progress and completion, furnace fuel and smelt output, sleep skipping to
  morning, mob pursuit and contact damage, oxygen depletion and recovery, cactus and lava contact
  damage, landing and lethal falls, block destruction and item pickup, portal transitions in both
  directions, spawn settling and chunk streaming, and crop growth. Two hand-derived timeout
  constants are deleted along with the comment justifying them, which no longer described anything
  real.
  
  Deliberately not routed, each for a reason rather than by omission: frame-rate floors, whose
  subject is throughput itself, so bounding them by frame progress would be circular; a wait on a
  child process output, which is not browser simulation at all; fixture entry points the code
  documents as isolated from the simulated-time path; and a short timeout inside an explicit retry
  loop, which is a probabilistic-action pattern rather than a timing assumption.
  
  One conversion was attempted and reverted. A touch-input wait compares a position delta between
  successive samples against a fixed threshold, and samples deliberately slowly. Polling it faster
  would leave the threshold number untouched while making the effective bar it expresses several
  times weaker — the assertion would read identically and quietly test less. Converting it honestly
  needs a configurable poll interval, which the helper does not yet offer, so it is left alone.

- [#31](https://github.com/nerima-games/mc-compose/pull/31) [`3b41ce8`](https://github.com/nerima-games/mc-compose/commit/3b41ce8223cb850f8e6f3bf5283950d84dab483c) Thanks [@takeokunn](https://github.com/takeokunn)! - Route five more simulation-gated waits that the earlier sweeps missed
  
  Two prior passes classified waits by property — does this depend on the simulation advancing — and
  routed everything they found that way. Continuous integration kept disagreeing with itself on
  reruns of the same commit afterwards anyway: 39 same-commit run pairs, 4 disagreements, each one a
  single spec failing in one run and passing in the other. That is the signature of a wait bounded by
  wall-clock time standing next to ones already fixed, not a new mechanism.
  
  Found by re-reading each already-routed file for an assertion sitting next to a
  `waitForSimulationProgress` call but not wrapped by one, and by reading files the earlier sweeps
  never touched at all:
  
  - The furnace cook-progress assertion in `player-experience.e2e.ts`, two lines below the comment
    that already says fuel consumption and smelt progress are both simulation-gated — the fuel and
    output waits were routed, this one in between was not.
  - Brewing's own start transition in `brewing-effects.e2e.ts` (the potion output field populating
    with its countdown) — the completion waits a few lines down were routed, the start was not.
  - The sticky-piston lever/piston extend and retract snapshots, in a file the earlier sweeps never
    touched — redstone signal propagation runs on the same tick schedule as everything else here.
  - The Nether bed explosion's block-destruction-and-damage settle in `sleep.e2e.ts`, in a file that
    already imports the helper for its other test and simply didn't use it for this one.
  - The End dragon's death settle in `end-journey.e2e.ts` — health hitting zero is observed inside the
    attack loop directly, but the exit portal materializing, the egg drop, and the experience award are
    follow-on effects the simulation applies on a later tick, the same shape documented elsewhere in
    this suite for a zombie's death-drop entity.
  
  Verified the mechanism directly rather than only by re-reading: a deterministic frame stall (the
  same `stallEachAnimationFrame` technique `bow-projectile.e2e.ts` already uses, because CPU
  throttling does not reproduce this) makes the pre-fix sticky-piston assertion fail exactly as
  described — "Timeout 5000ms exceeded while waiting on the predicate" with the transition still
  in flight — and the routed version pass under the identical stall.
  
  Two other shapes were investigated and found already handled: the touch-input and persistence
  delta-threshold assertions this project fixed before are still expressed in simulated time, not
  per-sample; the multiplayer-authority suites poll their own network revision counter rather than
  the frame counter, which a prior pass already identified as the correct shape for that signal.

- [#22](https://github.com/nerima-games/mc-compose/pull/22) [`06f20d5`](https://github.com/nerima-games/mc-compose/commit/06f20d58e7b9902660779de6bb9f0b089890d2a3) Thanks [@takeokunn](https://github.com/takeokunn)! - Wait on simulation progress rather than wall-clock in the browser suite, and stop concurrent checkouts sharing ports
  
  The browser suite had been failing a different test on nearly every run, in every environment, while each test passed in isolation. Six distinct tests failed across six runs with none failing twice, which is one defect in the harness rather than six in the game.
  
  The cause, measured rather than guessed. Every frame's simulated delta is clamped, so when the browser's frame delivery collapses under contention the simulation advances at a fraction of wall-clock speed — the observed rate was around four frames per second locally under load, and CI's own logs show about five. A window measured at 215ms at rest stretched to 770-900ms under load, consistently. Meanwhile the round trips carrying the assertions stayed under 111ms, so latency was never the problem.
  
  That clamp is correct: it exists so a stalled tab resumes in slow motion instead of teleporting through one enormous step. What was wrong was an assumption in the tests — every wall-clock timeout silently assumed simulated time runs at real time, which is false exactly when the machine is busy. Whichever test was mid-wait when a load spike landed was the one that timed out.
  
  So the simulation-gated waits now wait on simulation progress. A shared helper polls an atomic read of the frame counter and the value together in a single round trip, and holds two independent bounds: it fails fast if frames stop advancing at all, which is a genuine hang the previous design could not distinguish from slowness, and keeps a generous wall-clock backstop as a last resort. This is a strengthening rather than a relaxation — a bound in simulated ticks stays true on a slow machine and gets no weaker on a fast one, whereas a wall-clock bound on a simulation-gated event measures the runner's throughput instead of the game.
  
  Deliberately unchanged: the sustained-play frame-rate assertion, whose subject is frame throughput itself, so bounding it by frame progress would be circular. It should keep failing honestly when a runner is too slow, because that failure is real information.
  
  Separately, the harness could silently test the wrong build. Two worktrees of this repository both defaulted to the same fixed ports, and each would pass its own conflict check before racing for the URL — whichever server answered first was accepted by the other's health check. Ports are now derived from the checkout path, so concurrent checkouts have nothing to race over. Continuous integration is unaffected, having one checkout per job.
  
  Measured: three paired runs of the same spec under the same sustained load failed three times out of three before the change and passed three out of three after. A full suite run passes with no failures.

- [#24](https://github.com/nerima-games/mc-compose/pull/24) [`4efde18`](https://github.com/nerima-games/mc-compose/commit/4efde1883270215ad114bdeb80009ee686afb29f) Thanks [@takeokunn](https://github.com/takeokunn)! - Give the simulation wait a configurable sampling cadence, and route three more frame-gated waits
  
  Some waits are rate-sensitive: they compare a delta between successive samples against a fixed
  threshold, so the sampling interval is part of what the threshold means. Polling one of those
  faster leaves the number unchanged while making the bar it expresses weaker — the assertion reads
  identically and tests less. The helper therefore takes an optional sampling cadence, defaulting to
  what it already did so no existing caller moves.
  
  Three more files join the routed set — survival block placement, chunk lighting resolution, and
  both villager trade-status transitions — found by asking which waits depend on the simulation
  advancing rather than by matching the shapes already known.
  
  Also fixed: the real-time backstop defaulted to exactly the global test timeout, so the generic
  timeout fired first and hid the helper's own diagnostic message, which is the one that says
  whether frames were still advancing. Callers close to that boundary should set a shorter backstop
  explicitly.
  
  Two candidates were investigated and deliberately left unconverted, because a cadence parameter
  turns out not to be sufficient for either.
  
  A touch-input wait compares a movement delta between samples against a minimum. Preserving its
  original sampling rate keeps the threshold's meaning under a fixed frame rate, but not under a
  slow one: the simulation advances less within the same wall-clock interval, so the observed delta
  falls below the bar even though movement is proceeding correctly. The threshold is rate-based
  against real time, and making it correct means expressing it per unit of simulated time rather
  than per sample — a change to what it asserts, not to how it waits.
  
  The two multiplayer suites carry their own progress counter keyed to network synchronisation.
  Bounding them by a single page's frame counter would be actively wrong rather than imprecise: a
  client whose renderer is healthy while the sync pipeline stalls would look alive, so hang
  detection would never fire. They need a counterpart keyed to that signal.

- [#18](https://github.com/nerima-games/mc-compose/pull/18) [`17d5829`](https://github.com/nerima-games/mc-compose/commit/17d582998654f7542155e1b69f0cc9a56346532d) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.1.49

### Patch Changes

- [#9](https://github.com/nerima-games/mc-compose/pull/9) [`8df8fb5`](https://github.com/nerima-games/mc-compose/commit/8df8fb50bbcb9132f2b51b34cfa5081eacc1766a) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix CI: sync the `pnpm.overrides` pin for `@nerima-games/mx-gameplay` to the version already declared in `dependencies` (0.3.1), which was silently resolving to 0.2.1 and dropping the `drainBowKnockbacks` export the web client imports. Apply the org-standard oxlint scoped-strictness overrides for `test/**`, `scripts/**`, `apps/**`, `e2e/**`, and fix the real violations this surfaced under `src/**`. Make `vitest.config.ts`'s sibling `mc-audio` checkout resolution fall back to the installed registry package when no sibling checkout exists, so `pnpm test` runs in CI's single-repo checkout instead of throwing.

- [#16](https://github.com/nerima-games/mc-compose/pull/16) [`416bf85`](https://github.com/nerima-games/mc-compose/commit/416bf85473643c44360b082f8e673b2889428e46) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); release workflow added. mc-compose ships no library dist (unchanged) — `build:web` stays the Vite web bundle.

## 0.1.14

### Patch Changes

- Persist End progression and expose the complete Eye crafting, portal activation, dragon encounter, reward, and return journey through the web runtime.

  Align the composed runtime on `@nerima-games/mc-sim@0.1.29` so shapeless Eye of Ender crafting uses the same recipe implementation across gameplay and UI services.
