/**
 * @nerima-games/mc-compose — the composition repository.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
 *
 * ---------------------------------------------------------------------------
 * PRIME DIRECTIVE
 * ---------------------------------------------------------------------------
 *
 * THE ONLY CODE ADDED TO THIS REPOSITORY IS LAYER COMPOSITION AND THE STAGE
 * ORDER TABLE. Anything else moves to the module that owns it.
 *
 * The reference implementation's composition layer, `packages/app/application/`,
 * is 20,737 production LOC — roughly 13k of it game rules — and became
 * verifiable only through E2E. That is the origin of this entire rebuild
 * (plan.md §3.15, §8). This repository exists to not do that again.
 *
 * If you are about to add code here, the question is not "does it work" but
 * "which repository owns this". See docs/responsibility.md for the decision
 * table.
 *
 * ---------------------------------------------------------------------------
 * What it owns
 * ---------------------------------------------------------------------------
 *
 * - THE SINGLE TOTAL ORDERING OF FRAME STAGES (plan.md §2.3-3). Every other
 *   module declares only `after` constraints; compose resolves the total order.
 *   `domain/stage-order.ts` + `domain/stage-skeleton.ts`.
 * - Layer merge. `domain/composition.ts`.
 * - Session lifecycle, title <-> game. `domain/session.ts`.
 * - The QA / debug API surface. `domain/qa-api.ts`.
 * - The modding entry point. `domain/modding.ts`.
 * - The E2E suite — the final gate, and the only place cross-module
 *   interaction can be verified. Not yet present; see docs/testing.md.
 */

export * from './domain/composition'
export * from './domain/modding'
export * from './domain/qa-api'
export * from './domain/session'
export * from './domain/stage-order'
export * from './domain/stage-skeleton'
