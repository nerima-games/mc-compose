---
"@nerima-games/mc-compose": minor
---

Bring every internal dependency onto its current published version and fix the drift that forces

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
