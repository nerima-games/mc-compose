/**
 * registry.ts — the stable ID list of the status site (docs/ux/55 §3, D-07).
 *
 * Three things live here, and nothing else:
 *
 *   1. WHERE each repository publishes its `status/v1` result (I-47: a Pages
 *      JSON or a release asset, both fetched anonymously — an artifact zip
 *      needs a token, so the site never uses one). This module only names the
 *      URLs; fetching is the aggregator's job.
 *   2. WHICH check IDs exist and which DoD each one feeds. A check whose ID is
 *      not registered is not dropped: the aggregator shows it in the
 *      "unregistered results" column (55 §3), so `classifyCheck` returns a
 *      reason instead of throwing.
 *   3. WHAT each DoD requires to be present (`DOD_REQUIREMENTS`). Presence is
 *      part of the rule because "every check under `ux/` passed" is true for a
 *      run that reported no `ux/` check at all.
 *
 * The roster manifest (`test/e2e/roster.ts`) is not used for (1): it lists the
 * repositories that register frame stages, and it lacks mc-host-web, mc-kernel,
 * mc-save and mc-audio, which produce status results (D-07).
 */
import type { CheckGroup } from './schema'

export const ORGANIZATION = 'nerima-games'

/** The 17 repositories of the completion run (orchestration plan §2.4). */
export const REPOSITORIES = [
  'mc-compose',
  'mc-host-web',
  'mx-ui',
  'mx-gameplay',
  'mx-redstone',
  'mx-multiplayer',
  'mc-server',
  'mc-kernel',
  'mc-sim',
  'mc-save',
  'mc-worldgen',
  'mc-meshing',
  'mc-render',
  'mc-physics',
  'mc-noise',
  'mc-audio',
  'mc-dev-meta',
] as const

export type Repository = (typeof REPOSITORIES)[number]

export const DOD_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const

export type DodId = (typeof DOD_IDS)[number]

// ---------------------------------------------------------------------------
// Sources (I-47)
// ---------------------------------------------------------------------------

export type SourceLocation =
  | { readonly kind: 'pages'; readonly url: string }
  | { readonly kind: 'release'; readonly url: string }

export type StatusSource = {
  /** `owner/name`, equal to `StatusRun.repo` of the file it serves. */
  readonly repo: string
  /** Equal to `StatusRun.workflow` of the file it serves. */
  readonly workflow: string
  readonly location: SourceLocation
}

/** The tag of the rolling prerelease that carries a repository's results when it has no Pages site. */
export const RELEASE_STATUS_TAG = 'status-v1'

const fullName = (repository: string): string => `${ORGANIZATION}/${repository}`

const pagesSource = (repository: string, workflow: string): StatusSource => ({
  repo: fullName(repository),
  workflow,
  location: {
    kind: 'pages',
    url: `https://${ORGANIZATION}.github.io/${repository}/status/v1/${workflow}/latest.json`,
  },
})

const releaseSource = (repository: string, workflow: string, tag: string, asset: string): StatusSource => ({
  repo: fullName(repository),
  workflow,
  location: {
    kind: 'release',
    url: `https://github.com/${ORGANIZATION}/${repository}/releases/download/${tag}/${asset}`,
  },
})

/**
 * Every (repository, workflow) pair that publishes a `status/v1` file
 * (55 §3.1). mc-compose's own `ci/*` checks are not here: the aggregator
 * builds them from the GitHub API (DoD-6), so they have no file to fetch.
 *
 * Repositories with a Pages site (plan §2.2) publish there; the others attach
 * `<workflow>.json` to the rolling prerelease `status-v1`. mc-host-web's T0
 * measurements are attached by hand to its rolling prerelease `status-t0`
 * (plan §9.3), so that source is the one release asset that is not `status-v1`.
 */
export const SOURCES: ReadonlyArray<StatusSource> = [
  pagesSource('mc-compose', 'ci'),
  pagesSource('mc-compose', 'nightly'),
  pagesSource('mc-host-web', 'ci'),
  pagesSource('mc-host-web', 'nightly'),
  pagesSource('mc-host-web', 'release'),
  pagesSource('mc-host-web', 'deploy'),
  releaseSource('mc-host-web', 't0', 'status-t0', 'status-v1.json'),
  pagesSource('mx-gameplay', 'ci'),
  pagesSource('mx-multiplayer', 'ci'),
  pagesSource('mx-redstone', 'ci'),
  pagesSource('mx-ui', 'ci'),
  releaseSource('mc-audio', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-kernel', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-meshing', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-physics', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-render', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-save', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-sim', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
  releaseSource('mc-sim', 'nightly', RELEASE_STATUS_TAG, 'nightly.json'),
  releaseSource('mc-worldgen', 'ci', RELEASE_STATUS_TAG, 'ci.json'),
]

/**
 * A fetched file may only speak for the source it came from. Without this
 * check, any repository that can publish a file could report `journey/full`
 * as passed under another repository's name.
 */
export const isRunFromSource = (run: { readonly repo: string; readonly workflow: string }, source: StatusSource): boolean =>
  run.repo === source.repo && run.workflow === source.workflow

// ---------------------------------------------------------------------------
// Check IDs
// ---------------------------------------------------------------------------

/**
 * The 98 parity-ledger IDs of `docs/execution/completion-criteria.md`, in the
 * document's order. `registry.test.ts` compares this list with the document so
 * the two cannot drift apart.
 */
export const LEDGER_IDS: ReadonlyArray<string> = [
  'content/block-types',
  'content/item-types',
  'content/recipes',
  'content/enchantments',
  'content/mob-types',
  'content/biomes',
  'content/texture-atlas',
  'survival/movement',
  'survival/mining',
  'survival/placement',
  'survival/drops',
  'survival/hunger',
  'survival/health-fall-regen',
  'survival/death-respawn',
  'survival/save-load',
  'survival/day-night',
  'survival/xp',
  'crafting/grid-2x2',
  'crafting/grid-3x3',
  'crafting/furnace',
  'crafting/chest',
  'crafting/brewing',
  'crafting/anvil',
  'crafting/enchanting-table',
  'combat/melee',
  'combat/bow',
  'combat/armor',
  'combat/shield',
  'combat/status-effects',
  'combat/hit-feedback',
  'worldgen/terrain-biomes',
  'worldgen/caves-ores',
  'worldgen/trees-farming',
  'worldgen/passive-animals',
  'worldgen/villages',
  'worldgen/structures',
  'worldgen/nether',
  'worldgen/end-dragon',
  'worldgen/weather',
  'worldgen/sleep',
  'survival/creative-flight',
  'redstone/basic-components',
  'redstone/repeater',
  'redstone/piston',
  'redstone/observer',
  'redstone/hopper',
  'redstone/comparator',
  'redstone/dispenser',
  'multiplayer/seed-handshake',
  'multiplayer/entity-authority',
  'multiplayer/player-time-sync',
  'multiplayer/reconnect-binding',
  'multiplayer/dedicated-server',
  'ux/difficulty-selector',
  'ux/key-remapping',
  'ux/reduced-motion-ui-scale',
  'ux/gamepad',
  'ux/onboarding',
  'ux/graphics-presets-adaptive',
  'ux/f3-overlay',
  'ux/screenshot-key',
  'ux/pause-settings-savequit',
  'ux/colorblind',
  'ux/captions',
  'ux/fov-celebration',
  'gap/modding',
  'gap/boats',
  'gap/minecarts',
  'gap/ocean-depth',
  'gap/audio-live',
  'extension/wither',
  'performance/fps-rd5',
  'performance/fps-rd8',
  'performance/frustum-cull-ratio',
  'performance/teleport-readiness',
  'performance/test-suite-count',
  'perf/fr-0.1',
  'perf/fr-0.2',
  'perf/fr-0.3',
  'perf/fr-1.1',
  'perf/fr-1.2',
  'perf/fr-1.3',
  'perf/fr-1.4',
  'perf/fr-2.1',
  'perf/fr-2.2',
  'perf/fr-2.3',
  'perf/fr-2.4',
  'perf/fr-3.1',
  'perf/fr-3.2',
  'perf/fr-3.3',
  'perf/fr-3.4',
  'perf/fr-3.5',
  'perf/fr-4.1',
  'perf/fr-4.2',
  'perf/fr-4.3',
  'perf/fr-4.4',
  'perf/fr-4.5',
  'perf/fr-4.6',
]

/**
 * DoD-1 leaves out `extension/wither`, `perf/fr-4.5` and `perf/fr-4.6`
 * (completion-criteria.md, "Definition of done"). Their checks are registered
 * so they show up, but they feed no DoD.
 */
export const LEDGER_OUT_OF_SCOPE_IDS: ReadonlyArray<string> = ['extension/wither', 'perf/fr-4.5', 'perf/fr-4.6']

const numbered = (count: number, build: (index: number) => string): ReadonlyArray<string> =>
  Array.from({ length: count }, (_unused, index) => build(index + 1))

const twoDigits = (index: number): string => String(index).padStart(2, '0')

/** DoD-2: one count-and-ID comparison per content kind (completion-criteria.md, DoD-2). */
export const CONTENT_CHECK_IDS: ReadonlyArray<string> = [
  'content/blocks',
  'content/items',
  'content/recipes',
  'content/enchantments',
  'content/mobs',
  'content/biomes',
  'content/texture-tiles',
]

/** DoD-3: the verification catalog scope (completion-criteria.md, "Verification catalog scope"). */
export const CATALOG_CHECK_IDS: ReadonlyArray<string> = [
  'S01',
  'S02a',
  'S02b',
  'S02c',
  'S03a',
  'S03b',
  ...numbered(14, (index) => `S${twoDigits(index + 3)}`),
].map((id) => `catalog/${id}`)

/** DoD-5 measures R1–R5 and DoD-7 measures R6 (55 §4.3). */
export const PERF_DOD5_CHECK_IDS: ReadonlyArray<string> = numbered(5, (index) => `perf/R${index}`)
export const PERF_DOD7_CHECK_IDS: ReadonlyArray<string> = ['perf/R6']

/** DoD-6: the latest main CI run and the shared conformance action, per repository. */
export const CI_CHECK_IDS: ReadonlyArray<string> = REPOSITORIES.flatMap((repository) => [
  `ci/${repository}/main`,
  `ci/${repository}/conformance`,
])

/** DoD-10: one BGM check per scene (FR-A01). */
export const AUDIO_BGM_CHECK_IDS: ReadonlyArray<string> = [
  'day',
  'night',
  'cave',
  'underwater',
  'nether',
  'end',
  'creative',
  'title',
].map((scene) => `audio/bgm/${scene}`)

export const UX_CHECK_IDS: ReadonlyArray<string> = numbered(12, (index) => `ux/${index}`)

/** DoD-12: the progression targets (completion-criteria.md, "Progression targets"). */
export const PROGRESSION_CHECK_IDS: ReadonlyArray<string> = [
  'first-log',
  'wooden-pickaxe',
  'stone-tools',
  'first-cooked-food',
  'first-night',
  'first-iron',
  'bed',
  'death-risk-shelter',
  'death-risk-no-shelter',
  'hostile-damage-before-dusk',
].map((goal) => `progression/${goal}`)

/**
 * The states each screen is photographed in (55 §5.3: "全状態 × 2 言語 × 2 大きさ").
 * The authoritative list is `e2e/screens/catalog.ts` in mc-host-web, which does
 * not exist yet; its names must equal the design boards' Tweaks. Until it
 * does, this table is the provisional assignment: the names the screen docs
 * give in backticks (docs/ux 10, 20, 30) where they exist, otherwise the
 * board's Tweaks name, and `default` for a screen whose board has no Tweaks.
 * Where a board has two Tweaks axes (S25, S31) the pairs are spelled out.
 * Screens whose states the docs give only in Japanese prose (S03, S06, S11,
 * S12, S17, S20, S28, S32) therefore rest on the boards alone.
 */
export const SCREEN_STATES: Readonly<Record<string, ReadonlyArray<string>>> = {
  S01: ['firstRun', 'returning', 'returningNeedsRecovery', 'lockedElsewhere'],
  S02: ['default'],
  S03: ['default', 'showDelete'],
  S04: ['default'],
  S05: ['default'],
  S06: ['mining', 'combat', 'dusk'],
  S07: ['default', 'multiplayer', 'relockFailed'],
  S08: ['default'],
  S09: ['default'],
  S10: ['default'],
  S11: ['zombie', 'fall', 'drown', 'starve', 'lava'],
  S12: ['pause', 'title'],
  S13: ['default', 'saveFails'],
  S14: ['failed', 'retrying', 'recovered'],
  S15: ['idle', 'connecting', 'failed'],
  S16: ['default'],
  S17: ['chest', 'ender', 'shulker'],
  S18: ['sleeping', 'blocked', 'waiting'],
  S19: ['typing', 'playerList', 'unstable', 'disconnected'],
  S20: ['log', 'stone', 'repeater', 'comparator', 'wheat', 'endFrame'],
  S21: ['default'],
  S22: ['default'],
  S23: ['default'],
  S24: ['default'],
  S25: ['portalWait', 'travelNether', 'travelEnd', 'travelOverworld'],
  S26: ['default'],
  S27: ['default'],
  S28: ['default', 'system'],
  S29: ['default'],
  S30: ['webgl', 'storage', 'crash', 'outdated', 'updated', 'framed'],
  S31: ['hopper', 'hopperPowered', 'dispenser', 'dispenserPowered'],
  S32: ['map', 'compass', 'clock', 'spyglass'],
  S33: [
    'wrongTool',
    'longMining',
    'bow',
    'shield',
    'shieldDisabled',
    'riding',
    'hungerNoSprint',
    'absorption',
    'damageDirection',
    'fishing',
  ],
  S34: ['lure', 'love', 'cooldown', 'baby', 'shear'],
}

export const SCREEN_LANGUAGES: ReadonlyArray<string> = ['ja', 'en']

/** 1280×720 and 844×390, written by width as in `screen/S09/recipeBook/ja/1280`. */
export const SCREEN_WIDTHS: ReadonlyArray<string> = ['1280', '844']

/** DoD-13 needs a baseline comparison for every state, language and size (55 §5.3). */
export const SCREEN_CHECK_IDS: ReadonlyArray<string> = Object.entries(SCREEN_STATES).flatMap(([screen, states]) =>
  states.flatMap((state) =>
    SCREEN_LANGUAGES.flatMap((language) => SCREEN_WIDTHS.map((width) => `screen/${screen}/${state}/${language}/${width}`)),
  ),
)

type ExactEntry = {
  readonly ids: ReadonlyArray<string>
  readonly group: CheckGroup
  readonly dods: ReadonlyArray<DodId>
}

const inScopeLedger = LEDGER_IDS.filter((id) => !LEDGER_OUT_OF_SCOPE_IDS.includes(id))

const EXACT_ENTRIES: ReadonlyArray<ExactEntry> = [
  { ids: inScopeLedger.map((id) => `ledger/${id}`), group: 'ledger', dods: [1] },
  { ids: LEDGER_OUT_OF_SCOPE_IDS.map((id) => `ledger/${id}`), group: 'ledger', dods: [] },
  { ids: CONTENT_CHECK_IDS, group: 'content', dods: [2] },
  { ids: CATALOG_CHECK_IDS, group: 'catalog', dods: [3] },
  { ids: ['journey/full'], group: 'journey', dods: [4] },
  { ids: PERF_DOD5_CHECK_IDS, group: 'perf', dods: [5] },
  { ids: CI_CHECK_IDS, group: 'ci', dods: [6] },
  { ids: PERF_DOD7_CHECK_IDS, group: 'perf', dods: [7] },
  { ids: ['live/smoke'], group: 'live', dods: [8] },
  { ids: AUDIO_BGM_CHECK_IDS, group: 'audio', dods: [10] },
  { ids: UX_CHECK_IDS, group: 'ux', dods: [11] },
  { ids: PROGRESSION_CHECK_IDS, group: 'progression', dods: [12] },
  { ids: SCREEN_CHECK_IDS, group: 'screen', dods: [13] },
  // V04 shows these; no DoD counts them.
  { ids: numbered(17, (index) => `perf/P${twoDigits(index)}`), group: 'perf', dods: [] },
  { ids: numbered(9, (index) => `compose/C${twoDigits(index)}`), group: 'compose', dods: [] },
]

type OpenNamespace = {
  readonly prefix: string
  readonly group: CheckGroup
  readonly dods: ReadonlyArray<DodId>
}

/**
 * Namespaces whose members are not fully enumerable here: extra screen states,
 * journeys and features grow with
 * 40 §3, and audio events and licenses follow the files mc-audio ships. Every
 * member counts toward the DoD named here, so one failing screen fails DoD-13.
 */
const OPEN_NAMESPACES: ReadonlyArray<OpenNamespace> = [
  { prefix: 'journey/', group: 'journey', dods: [] },
  { prefix: 'feature/', group: 'feature', dods: [] },
  { prefix: 'screen/', group: 'screen', dods: [13] },
  { prefix: 'audio/', group: 'audio', dods: [10] },
  { prefix: 'audit/', group: 'audit', dods: [13] },
  { prefix: 'live/', group: 'live', dods: [] },
]

export type Registration = {
  readonly group: CheckGroup
  readonly dods: ReadonlyArray<DodId>
}

const EXACT_REGISTRATIONS: ReadonlyMap<string, Registration> = new Map(
  EXACT_ENTRIES.flatMap((entry) => entry.ids.map((id): [string, Registration] => [id, { group: entry.group, dods: entry.dods }])),
)

export type CheckClassification =
  | { readonly kind: 'registered'; readonly registration: Registration }
  | { readonly kind: 'unregistered'; readonly reason: 'unknown-id' | 'group-mismatch' }

/**
 * An exact entry wins over a namespace, so `live/smoke` feeds DoD-8 while
 * every other `live/*` check is only displayed. A check whose `group` differs
 * from its ID's namespace is unregistered rather than trusted: the group
 * selects the page that renders it.
 */
export const classifyCheck = (check: { readonly id: string; readonly group: CheckGroup }): CheckClassification => {
  const registration =
    EXACT_REGISTRATIONS.get(check.id) ??
    OPEN_NAMESPACES.find((namespace) => check.id.startsWith(namespace.prefix))
  if (registration === undefined) return { kind: 'unregistered', reason: 'unknown-id' }
  if (registration.group !== check.group) return { kind: 'unregistered', reason: 'group-mismatch' }
  return { kind: 'registered', registration: { group: registration.group, dods: registration.dods } }
}

// ---------------------------------------------------------------------------
// Who may publish which check (55 §3.1)
// ---------------------------------------------------------------------------

export type Publisher = { readonly repo: string; readonly workflow: string }

type PublisherRule = {
  readonly matches: (id: string) => boolean
  readonly publishers: ReadonlyArray<Publisher>
}

const host = (workflow: string): Publisher => ({ repo: fullName('mc-host-web'), workflow })
const exactly = (ids: ReadonlyArray<string>) => (id: string): boolean => ids.includes(id)
const under = (...prefixes: ReadonlyArray<string>) => (id: string): boolean => prefixes.some((prefix) => id.startsWith(prefix))

/**
 * The first matching rule decides, so a specific ID comes before its namespace.
 * An ID that no rule matches (the ledger, content counts, the catalog, audit
 * items and any audio check the table does not name) has no fixed publisher
 * in 55 §3.1 and is accepted from any source in `SOURCES`.
 *
 * A result from another publisher is ignored, because a DoD that needs one
 * repository's recording must not turn green on another repository's claim.
 * T0 measurements are published by hand under `t0` (plan §9.3), so the
 * performance results accept it as well.
 */
const PUBLISHER_RULES: ReadonlyArray<PublisherRule> = [
  { matches: exactly(['journey/full']), publishers: [host('release')] },
  { matches: exactly([...PERF_DOD5_CHECK_IDS, ...PERF_DOD7_CHECK_IDS]), publishers: [host('nightly'), host('release'), host('t0')] },
  { matches: under('journey/', 'feature/', 'ux/', 'screen/'), publishers: [host('ci'), host('nightly'), host('release')] },
  { matches: under('perf/'), publishers: [host('nightly'), host('release'), host('t0')] },
  { matches: under('live/'), publishers: [host('deploy')] },
  { matches: under('audio/recording/'), publishers: [host('nightly'), host('release')] },
  { matches: under('audio/bgm/', 'audio/event/', 'audio/license/'), publishers: [{ repo: fullName('mc-audio'), workflow: 'ci' }] },
  { matches: under('progression/'), publishers: [{ repo: fullName('mc-sim'), workflow: 'nightly' }] },
  { matches: under('ci/', 'compose/'), publishers: [{ repo: fullName('mc-compose'), workflow: 'ci' }, { repo: fullName('mc-compose'), workflow: 'nightly' }] },
]

/** The sources 55 §3.1 allows to publish `id`, or `undefined` when it leaves the publisher open. */
export const publishersOf = (id: string): ReadonlyArray<Publisher> | undefined =>
  PUBLISHER_RULES.find((rule) => rule.matches(id))?.publishers

export const isPublishedBy = (id: string, run: { readonly repo: string; readonly workflow: string }): boolean => {
  const publishers = publishersOf(id)
  return publishers === undefined || publishers.some((publisher) => publisher.repo === run.repo && publisher.workflow === run.workflow)
}

// ---------------------------------------------------------------------------
// What each DoD needs to be present
// ---------------------------------------------------------------------------

/** At least `min` checks under `prefix`, for a namespace whose members are not enumerable here. */
export type CoverageRequirement = {
  readonly prefix: string
  readonly min: number
}

export type DodRequirement = {
  /** Checks that must be present, not merely passing if present. */
  readonly requiredIds: ReadonlyArray<string>
  readonly coverage: ReadonlyArray<CoverageRequirement>
}

const requiredIdsOf = (dod: DodId): ReadonlyArray<string> =>
  EXACT_ENTRIES.filter((entry) => entry.dods.includes(dod)).flatMap((entry) => entry.ids)

const COVERAGE: Readonly<Partial<Record<DodId, ReadonlyArray<CoverageRequirement>>>> = {
  // FR-A02–A05 and the 30-minute recording each need at least one result (55 §3.1).
  10: [
    { prefix: 'audio/event/', min: 1 },
    { prefix: 'audio/license/', min: 1 },
    { prefix: 'audio/recording/', min: 1 },
  ],
  // The screens are enumerated by SCREEN_CHECK_IDS; the plan's high-rated audit items are not.
  13: [{ prefix: 'audit/', min: 1 }],
}

const requirement = (dod: DodId): DodRequirement => ({
  requiredIds: requiredIdsOf(dod),
  coverage: COVERAGE[dod] ?? [],
})

export const DOD_REQUIREMENTS: Readonly<Record<DodId, DodRequirement>> = {
  1: requirement(1),
  2: requirement(2),
  3: requirement(3),
  4: requirement(4),
  5: requirement(5),
  6: requirement(6),
  7: requirement(7),
  8: requirement(8),
  // DoD-9 reads the GitHub deployments API, not a check (55 §4.3), so nothing is required by ID.
  9: requirement(9),
  10: requirement(10),
  11: requirement(11),
  12: requirement(12),
  13: requirement(13),
}
