/**
 * check-roster-manifest.ts — the gate that keeps `test/e2e/roster.ts` honest.
 *
 * ---------------------------------------------------------------------------
 * The problem it exists for
 * ---------------------------------------------------------------------------
 *
 * `test/e2e/roster.ts` is a TRANSCRIPTION of every stage id and `after` edge
 * the sibling repositories register. It has to be a transcription:
 * plan.md §6 Step 3 publishes bottom-up, nothing is on GitHub Packages yet, and
 * mc-compose's `node_modules` contains no `@nerima-games/*` at all — so there is
 * no import that would give the real registrations.
 *
 * A transcription rots. This repository has already proved it: before the
 * roster manifest existed, two test files asserted against a list documented as
 * "the stage ids the roster actually registers today" that contained `input`,
 * `sim:physics`, `camera-mirror`, `chunk-sync`, `render` and `post-fx` — SIX
 * IDS NOBODY REGISTERS. The suite was green the whole time, because the
 * invented ids happen to land in the same phases as the real ones.
 *
 * So the manifest is paired with this: parse the siblings' real
 * `stages/stage-ids.ts` and `stages/registration.ts`, and fail if a single id,
 * a single `after` edge, or a single `file:line` citation disagrees.
 *
 * ---------------------------------------------------------------------------
 * Why it is NOT part of `pnpm verify`
 * ---------------------------------------------------------------------------
 *
 * It needs the sibling repositories checked out next to this one, which is true
 * on a developer's machine and false in this repository's CI — mc-compose is a
 * standalone public repository and CI clones only mc-compose. A gate that
 * cannot run in CI must not be in the gate that CI runs, or `pnpm verify` stops
 * meaning "this is green" (docs/architecture.md §4.4: the reference
 * implementation's `check-package-dag.ts` warned and exited 0, and a gate that
 * does not fail is documentation).
 *
 * It runs as `pnpm check:roster`, deliberately by hand, at the moment somebody
 * touches the roster — and it is the first thing to run when
 * `test/e2e/roster-frame-order.test.ts` fails for a reason nobody expected.
 *
 * ---------------------------------------------------------------------------
 * Where it looks
 * ---------------------------------------------------------------------------
 *
 *   1. `$MC_ROSTER_ROOT`, if set.
 *   2. `..` — sibling directories, the `ghq`/flat layout.
 *   3. `../mc-dev-meta/repos` — the development workspace's checkout set.
 *
 * The first candidate that contains a directory for every module named in the
 * manifest wins, and the chosen root is PRINTED, because the order above is not
 * cosmetic: these are two different checkouts of the same repositories and they
 * DO diverge. The first time this gate ran against both, `mc-dev-meta/repos`
 * was seventeen lines behind `..` on `mc-render/stages/registration.ts` — same
 * ids, same edges, moved citations. `..` is preferred because it is the working
 * copy that gets committed; `mc-dev-meta/repos` is a convenience mirror and can
 * lag. A failure naming line numbers and nothing else usually means the two
 * checkouts, not the manifest, are what disagree — check the printed root
 * first.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  ROSTER,
  ROSTER_REGISTERS_NOTHING,
  type RosterModule,
  type RosterStage,
} from '../test/e2e/roster'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Finding the checkouts
// ---------------------------------------------------------------------------

export const rosterRootCandidates = (env: Record<string, string | undefined>): ReadonlyArray<string> => {
  const fromEnv = env['MC_ROSTER_ROOT']
  return [
    ...(fromEnv === undefined || fromEnv === '' ? [] : [path.resolve(fromEnv)]),
    path.resolve(rootDir, '..'),
    path.resolve(rootDir, '..', 'mc-dev-meta', 'repos'),
  ]
}

/** Every repository this gate needs to be able to open. */
export const requiredRepositories = (): ReadonlyArray<string> => [
  ...ROSTER.map((module) => module.name),
  ...ROSTER_REGISTERS_NOTHING.map((entry) => entry.name),
]

export const findRosterRoot = (
  candidates: ReadonlyArray<string>,
  directoryExists: (at: string) => boolean,
): string | undefined =>
  candidates.find((candidate) =>
    requiredRepositories().every((name) => directoryExists(path.join(candidate, name))),
  )

// ---------------------------------------------------------------------------
// Reading the siblings' source
// ---------------------------------------------------------------------------

/** A stage id as some sibling really writes it, with the line it is on. */
export type ParsedStage = {
  readonly id: string
  readonly after: ReadonlyArray<string>
  /** 1-based line of the `id:` property inside `stages/registration.ts`. */
  readonly declaredAtLine: number
}

const parseFile = (filePath: string, text: string): ts.SourceFile =>
  ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

/** Unwrap `{...} as const`. */
const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node

/** `StageId('gameplay:fluids')` -> `gameplay:fluids`. */
const stageIdLiteral = (node: ts.Expression): string | undefined =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'StageId' &&
  node.arguments.length === 1 &&
  node.arguments[0] !== undefined &&
  ts.isStringLiteralLike(node.arguments[0])
    ? node.arguments[0].text
    : undefined

/**
 * `stages/stage-ids.ts` -> `{ "GAMEPLAY_STAGE_IDS.fluids": { id, line } }`.
 *
 * Every repository in the roster writes its ids the same way — one exported
 * `const X_STAGE_IDS = { name: StageId('...'), ... } as const` — so this is a
 * shape check rather than an evaluation. If a sibling ever stops writing them
 * that way, `resolve` below fails loudly on an unresolvable reference rather
 * than silently reporting no stages.
 */
export const parseStageIds = (
  filePath: string,
  text: string,
): ReadonlyMap<string, { readonly id: string; readonly line: number }> => {
  const sourceFile = parseFile(filePath, text)
  const found = new Map<string, { readonly id: string; readonly line: number }>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
      if (initializer === undefined || !ts.isIdentifier(declaration.name)) {
        continue
      }
      const literal = unwrap(initializer)
      if (!ts.isObjectLiteralExpression(literal)) {
        continue
      }
      for (const property of literal.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
          continue
        }
        const id = stageIdLiteral(property.initializer)
        if (id !== undefined) {
          found.set(`${declaration.name.text}.${property.name.text}`, {
            id,
            line: lineOf(sourceFile, property),
          })
        }
      }
    }
  }

  return found
}

/** Resolve an expression appearing as `id:` or inside `after: [...]`. */
const resolve = (
  node: ts.Expression,
  ids: ReadonlyMap<string, { readonly id: string }>,
): string | undefined => {
  const direct = stageIdLiteral(node)
  if (direct !== undefined) {
    return direct
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return ids.get(`${node.expression.text}.${node.name.text}`)?.id
  }
  return undefined
}

/**
 * `stages/registration.ts` -> the stages it registers, in source order.
 *
 * A registration is recognised as an object literal carrying BOTH an `id` and a
 * `run` — the two members of `StageRegistration` that are not optional. Keying
 * on `id` alone would also match the `UPSTREAM_STAGE_IDS` documentation
 * examples that several repositories keep in their headers.
 */
export const parseRegistrations = (
  filePath: string,
  text: string,
  ids: ReadonlyMap<string, { readonly id: string }>,
): { readonly stages: ReadonlyArray<ParsedStage>; readonly unresolved: ReadonlyArray<string> } => {
  const sourceFile = parseFile(filePath, text)
  const stages: Array<ParsedStage> = []
  const unresolved: Array<string> = []

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const named = (want: string): ts.PropertyAssignment | undefined =>
        node.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === want,
        )

      const idProperty = named('id')
      if (idProperty !== undefined && named('run') !== undefined) {
        const id = resolve(idProperty.initializer, ids)
        if (id === undefined) {
          unresolved.push(`${filePath}:${String(lineOf(sourceFile, idProperty))} — cannot resolve the \`id\``)
        } else {
          const afterProperty = named('after')
          const afterNodes =
            afterProperty !== undefined && ts.isArrayLiteralExpression(unwrap(afterProperty.initializer))
              ? (unwrap(afterProperty.initializer) as ts.ArrayLiteralExpression).elements
              : []
          const after: Array<string> = []
          for (const element of afterNodes) {
            const edge = resolve(element, ids)
            if (edge === undefined) {
              unresolved.push(
                `${filePath}:${String(lineOf(sourceFile, element))} — cannot resolve an \`after\` edge`,
              )
            } else {
              after.push(edge)
            }
          }
          stages.push({ id, after, declaredAtLine: lineOf(sourceFile, idProperty) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { stages, unresolved }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type Io = {
  readonly readFile: (at: string) => string | undefined
  readonly directoryExists: (at: string) => boolean
}

const describeStage = (stage: RosterStage): string =>
  `${stage.id}${stage.after.length === 0 ? '' : ` after [${stage.after.join(', ')}]`}`

const describeParsed = (stage: ParsedStage): string =>
  `${stage.id}${stage.after.length === 0 ? '' : ` after [${stage.after.join(', ')}]`}`

export const compareModule = (
  root: string,
  module: RosterModule,
  io: Io,
): ReadonlyArray<string> => {
  const idsPath = path.join(root, module.name, 'stages', 'stage-ids.ts')
  const registrationPath = path.join(root, module.name, 'stages', 'registration.ts')

  const idsText = io.readFile(idsPath)
  const registrationText = io.readFile(registrationPath)
  if (idsText === undefined || registrationText === undefined) {
    return [
      `${module.name}: the manifest says it registers ${String(module.stages.length)} stage(s), but ` +
        `${idsText === undefined ? 'stages/stage-ids.ts' : 'stages/registration.ts'} does not exist.`,
    ]
  }

  const ids = parseStageIds(idsPath, idsText)
  const parsed = parseRegistrations(registrationPath, registrationText, ids)
  const problems: Array<string> = [...parsed.unresolved]

  const expected = module.stages.map(describeStage)
  const actual = parsed.stages.map(describeParsed)
  if (expected.join('\n') !== actual.join('\n')) {
    problems.push(
      `${module.name}: the registrations do not match the manifest.\n` +
        `    manifest: ${expected.join('\n              ') || '(none)'}\n` +
        `    on disk:  ${actual.join('\n              ') || '(none)'}`,
    )
    return problems
  }

  // The citations. A `file:line` that has drifted is not cosmetic: it is the
  // only thing that lets a reader check the transcription without re-deriving
  // it, and the manifest's whole claim is that it was read from those lines.
  module.stages.forEach((stage, index) => {
    const onDisk = parsed.stages[index]
    const mintedAt = ids.get(
      [...ids.entries()].find(([, value]) => value.id === stage.id)?.[0] ?? '',
    )
    const expectedDeclared = `${module.name}/stages/registration.ts:${String(onDisk?.declaredAtLine ?? 0)}`
    const expectedMinted = `${module.name}/stages/stage-ids.ts:${String(mintedAt?.line ?? 0)}`

    if (stage.declaredAt !== expectedDeclared) {
      problems.push(
        `${stage.id}: manifest cites \`${stage.declaredAt}\`, but the registration is at \`${expectedDeclared}\`.`,
      )
    }
    if (stage.idAt !== expectedMinted) {
      problems.push(
        `${stage.id}: manifest cites \`${stage.idAt}\`, but the id is minted at \`${expectedMinted}\`.`,
      )
    }
  })

  return problems
}

/**
 * A repository the manifest says registers nothing must still register nothing.
 *
 * THIS CHECK HAS ALREADY EARNED ITS KEEP, TWICE IN ONE DAY. `mc-sim` and
 * `mx-multiplayer` were both listed under `ROSTER_REGISTERS_NOTHING`; both grew
 * a `stages/` directory, and this function is what said so — parsing the new
 * directories, naming `sim:physics` and then `multiplayer:inbound,
 * multiplayer:outbound`, and failing. Neither was noticed by a human first.
 *
 * The failure is deliberately not "an id is missing from the manifest" but "the
 * frame has changed": binding `sim:physics` turned four dangling cross-repository
 * edges into real ones, and the two `multiplayer:` ids matched no phase at all,
 * which is what put two new phases into `domain/stage-skeleton.ts`. A gate that
 * only reported the ids would have made that look like a transcription chore.
 */
export const compareSilentModule = (
  root: string,
  entry: { readonly name: string },
  io: Io,
): ReadonlyArray<string> => {
  const registrationPath = path.join(root, entry.name, 'stages', 'registration.ts')
  const text = io.readFile(registrationPath)
  if (text === undefined) {
    return []
  }
  const idsText = io.readFile(path.join(root, entry.name, 'stages', 'stage-ids.ts')) ?? ''
  const parsed = parseRegistrations(
    registrationPath,
    text,
    parseStageIds(path.join(root, entry.name, 'stages', 'stage-ids.ts'), idsText),
  )
  return parsed.stages.length === 0
    ? []
    : [
        `${entry.name}: the manifest lists it under ROSTER_REGISTERS_NOTHING, but it now registers ` +
          `${parsed.stages.map((stage) => stage.id).join(', ')}. The frame has changed — re-read ` +
          'test/e2e/roster.ts and docs/testing.md §3.',
      ]
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const run = (
  root: string,
  io: Io,
): { readonly problems: ReadonlyArray<string>; readonly stageCount: number } => {
  const problems = [
    ...ROSTER.flatMap((module) => compareModule(root, module, io)),
    ...ROSTER_REGISTERS_NOTHING.flatMap((entry) => compareSilentModule(root, entry, io)),
  ]
  return {
    problems,
    stageCount: ROSTER.reduce((total, module) => total + module.stages.length, 0),
  }
}

export const main = (env: Record<string, string | undefined>): number => {
  const io: Io = {
    readFile: (at) => ts.sys.readFile(at),
    directoryExists: (at) => ts.sys.directoryExists(at),
  }

  const candidates = rosterRootCandidates(env)
  const root = findRosterRoot(candidates, io.directoryExists)

  if (root === undefined) {
    console.error('check:roster: no checkout of the sibling repositories was found.')
    console.error('')
    console.error('Looked in:')
    for (const candidate of candidates) {
      console.error(`  ${candidate}`)
    }
    console.error('')
    console.error('Every one of these must be a directory under the chosen root:')
    console.error(`  ${requiredRepositories().join(' ')}`)
    console.error('')
    console.error('Set MC_ROSTER_ROOT to the directory that holds them. This gate is NOT part of')
    console.error('`pnpm verify` precisely because it cannot run without them — see the header of')
    console.error('scripts/check-roster-manifest.ts.')
    return 1
  }

  const { problems, stageCount } = run(root, io)

  if (problems.length === 0) {
    console.log(
      `check:roster: OK — test/e2e/roster.ts matches ${String(ROSTER.length)} repositories ` +
        `(${String(stageCount)} stages) at ${root}.`,
    )
    return 0
  }

  console.error(`check:roster: test/e2e/roster.ts is STALE against ${root}:`)
  console.error('')
  for (const problem of problems) {
    console.error(`  ${problem}`)
  }
  console.error('')
  console.error('The manifest is a transcription of what the siblings register, and it has drifted.')
  console.error('Update test/e2e/roster.ts — including PLAN_4_2_FRAME and EXPECTED_PHASE_OF — and')
  console.error('then read test/e2e/roster-frame-order.test.ts to see what the change did to the frame.')
  return 1
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  process.exit(main(process.env))
}
