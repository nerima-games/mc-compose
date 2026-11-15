/**
 * check-roster-manifest.ts — the gate that keeps `test/e2e/roster.ts` honest.
 *
 * ---------------------------------------------------------------------------
 * The problem it exists for
 * ---------------------------------------------------------------------------
 *
 * `test/e2e/roster.ts` is a TRANSCRIPTION of every stage id and `after` edge
 * the sibling repositories register. It has to be a transcription: package
 * pins provide runtime and type contracts, but no import substitutes for
 * sibling source-level stage ownership and file:line provenance.
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
 *
 * ---------------------------------------------------------------------------
 * Wave 0 (2026-08-30): the parsing layer moved from the TypeScript compiler
 * API to ast-grep
 * ---------------------------------------------------------------------------
 *
 * TypeScript 7.0.2's npm package no longer exports the classic compiler API
 * this file used to import (`ts.createSourceFile`, `ts.forEachChild`, the
 * `ts.isXxxExpression` guards): its package.json `exports` map now resolves
 * `"."` to a version-info stub, and the only other exported subpaths are the
 * explicitly-unstable `typescript/unstable/ast/*` family, which does not
 * expose a parser entry point at all. Rewriting against that unstable API, or
 * reintroducing an old-typescript alias, are both worse than the alternative
 * the org settled on: ast-grep, already Nix-pinned and stable, shelled out to
 * per file via `ast-grep scan --inline-rules ... --json=compact --stdin`.
 *
 * Manifest comparison still checks ids, `after` edges and source citations.
 * `parseRegistrations` accepts an optional source reader for following local
 * imports and factory returns from a module's `frameStages` field. Factory
 * registrations retain the file and line of their actual `id:` property.
 *
 * Direct-object extraction runs as ast-grep relational rules,
 * matched against each file's TEXT over stdin — not a rebuilt filesystem read,
 * so the function signatures `(filePath, text)` stay exactly what they were.
 * Each rule captures a metavariable named `$REGOBJ` for the enclosing
 * `{ id, run }` object literal; because ast-grep reports that metavariable's
 * own byte range on every match, two matches that share the same `REGOBJ`
 * range are known to belong to the same registration without any relational
 * bookkeeping on this file's part — that correlation is what lets `id`,
 * `after` elements, and the `run`-sibling requirement live in independent
 * rules instead of one large one.
 *
 * The source graph follows named local imports/re-exports, constant aliases,
 * object/array spreads and static factory returns. Constructor aliases resolve
 * to the kernel's `StageId` import; spread aliases retain the minting line.
 * Text-only callers retain direct-object parsing, including ids looked up by
 * either a bare constant name or `NAME.prop`.
 *
 * What is NOT expressible this way — a template literal, a spread, a
 * parenthesized or computed expression inside `after: [...]` — is caught by
 * comparing the count of `after` array elements (from a whole-array rule) to
 * the count of elements matched by the four specific-shape rules for that same
 * `REGOBJ`. A mismatch means an element in a form nothing above recognises is
 * present, and it is reported as unresolved at the array's own line rather
 * than silently dropped — "fail loud on what cannot be expressed, never skip
 * it" (org decision, 2026-08-30). No sibling source seen while building this
 * uses a fifth form; this exists so a future one is reported, not swallowed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
// Reading the siblings' source, via ast-grep
// ---------------------------------------------------------------------------

/** A stage id as some sibling really writes it, with the line it is on. */
export type ParsedStage = {
  readonly id: string
  readonly after: ReadonlyArray<string>
  /** 1-based line of the `id:` property, including registrations returned by factories. */
  readonly declaredAtLine: number
  readonly declaredAtFile?: string
}

type AstGrepPosition = { readonly line: number; readonly column: number }
type AstGrepByteRange = { readonly start: number; readonly end: number }
type AstGrepRange = {
  readonly start: AstGrepPosition
  readonly end: AstGrepPosition
  readonly byteOffset: AstGrepByteRange
}
type AstGrepMetaVar = { readonly text: string; readonly range: AstGrepRange }
type AstGrepMatch = {
  readonly ruleId: string
  readonly text: string
  readonly range: AstGrepRange
  readonly metaVariables: {
    readonly single: Readonly<Record<string, AstGrepMetaVar>>
    readonly multi: Readonly<Record<string, ReadonlyArray<AstGrepMetaVar>>>
  }
}

const AST_GREP_TIMEOUT_MS = 30_000

/**
 * Run ast-grep against `text` over stdin and return its matches.
 *
 * `--stdin` (rather than writing `text` to a temp file) is what keeps this
 * function's signature identical to the compiler-API version's: callers,
 * including the test suite, hand it a string, not a path that has to exist on
 * disk. Line numbers ast-grep reports are therefore relative to the start of
 * `text` itself, exactly like `ts.SourceFile.getLineAndCharacterOfPosition`
 * used to be.
 */
const runAstGrep = (rules: string, text: string): ReadonlyArray<AstGrepMatch> => {
  let stdout: string
  try {
    stdout = execFileSync('ast-grep', ['scan', '--inline-rules', rules, '--json=compact', '--stdin'], {
      input: text,
      encoding: 'utf8',
      timeout: AST_GREP_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (cause) {
    throw new Error('check:roster: ast-grep invocation failed', { cause })
  }
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) {
    throw new Error('check:roster: ast-grep did not return a JSON array')
  }
  return parsed as ReadonlyArray<AstGrepMatch>
}

/** ast-grep reports 0-based lines; every other part of this file is 1-based. */
const oneBasedLine = (match: Pick<AstGrepMatch, 'range'>): number => match.range.start.line + 1

const byteRangeKey = (range: AstGrepByteRange): string => `${String(range.start)}:${String(range.end)}`

/**
 * `stages/stage-ids.ts` -> `{ "GAMEPLAY_STAGE_IDS.fluids": { id, line } }`.
 *
 * Static source matching follows constructor aliases and object spreads while
 * keeping each id's original minting line. It does not execute sibling code.
 */
const fieldRule = (kind: string, fields: Readonly<Record<string, string>>) => ({
  all: [
    { kind },
    ...Object.entries(fields).map(([field, capture]) => ({
      has: { field, pattern: `$${capture}` },
    })),
  ],
})

const SOURCE_RULES = [
  ['binding', fieldRule('variable_declarator', { name: 'NAME', value: 'VALUE' })],
  ['pair', fieldRule('pair', { key: 'KEY', value: 'VALUE' })],
  ['call', fieldRule('call_expression', { function: 'CALLEE', arguments: 'ARGS' })],
  ['member', fieldRule('member_expression', { object: 'OBJECT', property: 'PROPERTY' })],
  ['function', fieldRule('arrow_function', { body: 'BODY' })],
  ['function', fieldRule('function_expression', { body: 'BODY' })],
  ['function', fieldRule('generator_function', { body: 'BODY' })],
  ['declaration', fieldRule('function_declaration', { name: 'NAME', body: 'BODY' })],
  ['import', fieldRule('import_statement', { source: 'SOURCE' })],
  ['export', fieldRule('export_statement', { source: 'SOURCE' })],
  ['return', { pattern: 'return $VALUE' }],
  ['array', { pattern: '[$$$ITEMS]' }],
  ['object', { pattern: { context: 'const X = { $$$ITEMS }', selector: 'object' } }],
  ['arguments', { pattern: { context: 'f($$$ITEMS)', selector: 'arguments' } }],
  ['unwrap', { pattern: { context: 'const X = ($VALUE)', selector: 'parenthesized_expression' } }],
  ['unwrap', { pattern: { context: 'const X = $VALUE as $TYPE', selector: 'as_expression' } }],
  ['unwrap', { pattern: { context: 'const X = $VALUE as const', selector: 'as_expression' } }],
  ['unwrap', { pattern: { context: 'function* f() { yield* $VALUE }', selector: 'yield_expression' } }],
  ['spread', { pattern: { context: 'const X = [...$VALUE]', selector: 'spread_element' } }],
].map(([id, rule], index) => JSON.stringify({ id: `${String(id)}-${String(index)}`, language: 'TypeScript', rule }))
  .join('\n---\n')

type Source = {
  readonly file: string
  readonly nodes: ReadonlyArray<AstGrepMatch>
}
type Expression = { readonly source: Source; readonly ref: AstGrepMetaVar }
type SourceReader = (file: string) => Source
type MintedId = { readonly id: string; readonly line: number }

const kindOf = (node: AstGrepMatch | undefined): string => node?.ruleId.split('-')[0] ?? ''
const contains = (outer: AstGrepMetaVar, inner: AstGrepMetaVar): boolean =>
  outer.range.byteOffset.start <= inner.range.byteOffset.start &&
  outer.range.byteOffset.end >= inner.range.byteOffset.end
const child = (expression: Expression, name: string): Expression => {
  const node = expression.source.nodes.find((item) => byteRangeKey(item.range.byteOffset) === byteRangeKey(expression.ref.range.byteOffset))
  const ref = node?.metaVariables.single[name]
  if (ref === undefined) throw new Error(`unsupported expression: ${expression.ref.text}`)
  return { source: expression.source, ref }
}
const nodeOf = (expression: Expression): AstGrepMatch | undefined =>
  expression.source.nodes.find((node) => byteRangeKey(node.range.byteOffset) === byteRangeKey(expression.ref.range.byteOffset))
const itemsOf = (expression: Expression): ReadonlyArray<Expression> =>
  (nodeOf(expression)?.metaVariables.multi['ITEMS'] ?? [])
    .filter((ref) => ref.text !== ',' && !ref.text.startsWith('//') && !ref.text.startsWith('/*'))
    .map((ref) => ({ source: expression.source, ref }))
const sourceReader = (readFile: (file: string) => string | undefined): SourceReader => {
  const sources = new Map<string, Source>()
  return (file) => {
    const cached = sources.get(file)
    if (cached !== undefined) return cached
    const text = readFile(file)
    if (text === undefined) throw new Error(`cannot read imported source ${file}`)
    const source = { file, nodes: runAstGrep(SOURCE_RULES, text) }
    sources.set(file, source)
    return source
  }
}

const importedSource = (source: Source, specifier: string, read: SourceReader): Source => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw new Error(`cannot follow external import ${specifier}`)
  }
  return read(path.resolve(path.dirname(source.file), specifier.replace(/\.js$/u, '.ts')))
}

const namedBindings = (text: string): ReadonlyArray<readonly [string, string]> => {
  const names = /\{([^}]+)\}/u.exec(text)?.[1]
  return (names ?? '').split(',').flatMap((entry) => {
    if (entry.trim().startsWith('type ')) return []
    const match = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/u.exec(entry)
    return match?.[1] === undefined ? [] : [[match[1], match[2] ?? match[1]] as const]
  })
}

const enclosingFunction = (source: Source, ref: AstGrepMetaVar): AstGrepMatch | undefined =>
  source.nodes.filter((node) => ['function', 'declaration'].includes(kindOf(node)) && contains(node, ref))
    .sort((left, right) => left.text.length - right.text.length)[0]

const symbol = (expression: Expression, read: SourceReader): Expression | 'StageId' => {
  const { source, ref } = expression
  const bindings = source.nodes.filter((node) => {
    if (!['binding', 'declaration'].includes(kindOf(node)) || node.metaVariables.single['NAME']?.text !== ref.text) return false
    const scope = enclosingFunction(source, node)
    return scope === undefined || contains(scope, ref)
  }).sort((left, right) =>
    (enclosingFunction(source, left)?.text.length ?? Infinity) -
    (enclosingFunction(source, right)?.text.length ?? Infinity),
  )
  const binding = bindings[0]
  if (binding !== undefined) {
    return kindOf(binding) === 'declaration'
      ? { source, ref: binding }
      : { source, ref: binding.metaVariables.single['VALUE']! }
  }
  for (const node of source.nodes.filter((item) => ['import', 'export'].includes(kindOf(item)))) {
    const specifier = unquote(node.metaVariables.single['SOURCE']!.text)
    const named = namedBindings(node.text).find(([, local]) => local === ref.text)
    if (named !== undefined) {
      if (kindOf(node) === 'import' && specifier === '@nerima-games/mc-kernel' && named[0] === 'StageId') return 'StageId'
      const target = importedSource(source, specifier, read)
      return { source: target, ref: { ...ref, text: named[0], range: { ...ref.range, byteOffset: { start: -1, end: -1 } } } }
    }
    if (kindOf(node) === 'export' && /^export\s+\*\s+from/u.test(node.text)) {
      const target = importedSource(source, specifier, read)
      if (target.nodes.some((item) => item.metaVariables.single['NAME']?.text === ref.text || namedBindings(item.text).some(([, name]) => name === ref.text))) {
        return { source: target, ref: { ...ref, range: { ...ref.range, byteOffset: { start: -1, end: -1 } } } }
      }
    }
  }
  throw new Error(`cannot resolve symbol ${ref.text} in ${source.file}`)
}

const expressionKey = ({ source, ref }: Expression): string =>
  `${source.file}:${byteRangeKey(ref.range.byteOffset)}:${ref.text}`

const resolveExpression = (
  expression: Expression,
  read: SourceReader,
  visited: ReadonlySet<string> = new Set(),
): Expression | 'StageId' => {
  const key = expressionKey(expression)
  if (visited.has(key)) throw new Error(`cyclic reference: ${expression.ref.text}`)
  const next = new Set([...visited, key])
  const node = nodeOf(expression)
  if (kindOf(node) === 'unwrap' || kindOf(node) === 'spread') {
    return resolveExpression(child(expression, 'VALUE'), read, next)
  }
  if (/^[A-Za-z_$][\w$]*$/u.test(expression.ref.text)) {
    const target = symbol(expression, read)
    return target === 'StageId' ? target : resolveExpression(target, read, next)
  }
  if (node !== undefined && kindOf(node) === 'member') {
    const object = resolveExpression(child(expression, 'OBJECT'), read, next)
    if (object === 'StageId') throw new Error('cannot read a property of StageId')
    const returned = factoryResult(object, read, next)
    return resolveExpression(objectProperty(returned, child(expression, 'PROPERTY').ref.text, read, next), read, next)
  }
  return expression
}

const objectProperties = (expression: Expression, read: SourceReader, visited: ReadonlySet<string>): ReadonlyMap<string, Expression> => {
  const resolved = resolveExpression(expression, read, visited)
  if (resolved === 'StageId' || kindOf(nodeOf(resolved)) !== 'object') throw new Error('expected an object literal')
  const properties = new Map<string, Expression>()
  for (const item of itemsOf(resolved)) {
    if (kindOf(nodeOf(item)) === 'spread') {
      for (const [name, value] of objectProperties(child(item, 'VALUE'), read, new Set([...visited, expressionKey(resolved)]))) properties.set(name, value)
    } else if (/^[A-Za-z_$][\w$]*$/u.test(item.ref.text)) {
      properties.set(item.ref.text, item)
    } else {
      const name = child(item, 'KEY').ref.text
      properties.set(name, child(item, 'VALUE'))
    }
  }
  return properties
}

const objectProperty = (expression: Expression, name: string, read: SourceReader, visited: ReadonlySet<string>): Expression => {
  const property = objectProperties(expression, read, visited).get(name)
  if (property === undefined) throw new Error(`cannot resolve property ${name}`)
  return property
}

const returnedExpression = (expression: Expression, read: SourceReader, visited: ReadonlySet<string>): Expression => {
  const callee = child(expression, 'CALLEE')
  const args = itemsOf(child(expression, 'ARGS'))
  if (callee.ref.text === 'Effect.succeed' && args.length === 1) return args[0]!
  if (kindOf(nodeOf(callee)) === 'member' && child(callee, 'PROPERTY').ref.text === 'pipe') {
    if (args.length === 0 || args.some((arg) => arg.ref.text !== 'Effect.orDie')) throw new Error('unsupported stage factory pipe')
    return child(callee, 'OBJECT')
  }
  if (callee.ref.text === 'Effect.flatMap') {
    const callback = args[1]
    if (callback === undefined || kindOf(nodeOf(callback)) !== 'call' || child(callback, 'CALLEE').ref.text !== 'Option.match') throw new Error('unsupported stage factory branch')
    const cases = itemsOf(child(callback, 'ARGS'))[0]
    if (cases === undefined) throw new Error('missing Option.match branches')
    const branches = ['onNone', 'onSome'].map((name) => {
      const fn = resolveExpression(objectProperty(cases, name, read, visited), read, visited)
      if (fn === 'StageId') throw new Error('invalid Option.match branch')
      return factoryResult(functionReturn(fn), read, visited)
    })
    if (expressionKey(branches[0]!) !== expressionKey(branches[1]!)) throw new Error('stage factory branches return different registrations')
    return branches[0]!
  }
  const fn = callee.ref.text === 'Effect.gen'
    ? args[0]
    : callee.ref.text === 'Effect.map'
      ? (args[1] === undefined ? undefined : resolveExpression(args[1], read, visited))
      : resolveExpression(callee, read, visited)
  if (fn === undefined || fn === 'StageId') throw new Error(`unsupported factory ${callee.ref.text}`)
  return functionReturn(fn)
}

const functionReturn = (fn: Expression): Expression => {
  const body = child(fn, 'BODY')
  if (!body.ref.text.startsWith('{')) return body
  const returns = fn.source.nodes.filter((node) => kindOf(node) === 'return' && contains(body.ref, node) && enclosingFunction(fn.source, node) === nodeOf(fn))
  if (returns.length !== 1) throw new Error('factory must have one static return')
  return { source: fn.source, ref: returns[0]!.metaVariables.single['VALUE']! }
}

const factoryResult = (expression: Expression, read: SourceReader, visited: ReadonlySet<string>): Expression => {
  const resolved = resolveExpression(expression, read, visited)
  if (resolved === 'StageId') throw new Error('expected a stage factory result')
  if (kindOf(nodeOf(resolved)) !== 'call') return resolved
  const key = expressionKey(resolved)
  if (visited.has(key)) throw new Error(`cyclic factory: ${resolved.ref.text}`)
  return factoryResult(returnedExpression(resolved, read, visited), read, new Set([...visited, key]))
}

const mintedId = (expression: Expression, read: SourceReader): MintedId => {
  const resolved = resolveExpression(expression, read)
  if (resolved === 'StageId' || kindOf(nodeOf(resolved)) !== 'call') throw new Error(`cannot resolve the id ${expression.ref.text}`)
  if (resolveExpression(child(resolved, 'CALLEE'), read) !== 'StageId') throw new Error(`id is not minted by StageId: ${expression.ref.text}`)
  const args = itemsOf(child(resolved, 'ARGS'))
  const arg = args[0]?.ref.text
  if (args.length !== 1 || arg === undefined || !/^(['"]).*\1$/u.test(arg)) throw new Error('StageId requires a string literal')
  return { id: unquote(arg), line: oneBasedLine(resolved.ref) }
}

const unquote = (literal: string): string => literal.slice(1, -1)

export const parseStageIds = (
  filePath: string,
  text: string,
): ReadonlyMap<string, { readonly id: string; readonly line: number }> => {
  const found = new Map<string, { readonly id: string; readonly line: number }>()
  const read = sourceReader((file) => file === filePath ? text : undefined)
  const source = read(filePath)
  for (const binding of source.nodes.filter((node) => kindOf(node) === 'binding' && enclosingFunction(source, node) === undefined)) {
    const name = binding.metaVariables.single['NAME']!.text
    const expression = { source, ref: binding.metaVariables.single['VALUE']! }
    try {
      const resolved = resolveExpression(expression, read)
      if (resolved !== 'StageId' && kindOf(nodeOf(resolved)) === 'object') {
        for (const [property, value] of objectProperties(resolved, read, new Set())) {
          try { found.set(`${name}.${property}`, mintedId(value, read)) } catch { /* A referenced unresolved value is diagnosed at its registration. */ }
        }
      } else {
        found.set(name, mintedId(expression, read))
      }
    } catch { /* Non-id constants do not mint stage ids. */ }
  }
  return found
}

/** Match every direct `id:` shape beside `run`, so unsupported values are diagnosed. */
const ID_RULES = `
id: registration-id
language: TypeScript
rule:
  all:
    - kind: pair
    - has: { field: key, regex: "^id$" }
    - has:
        field: value
        pattern: $VALUE
  inside:
    all:
      - kind: object
      - pattern: $REGOBJ
    stopBy: neighbor
    has:
      kind: pair
      stopBy: neighbor
      has:
        field: key
        regex: "^run$"
`

const AFTER_ELEMENT_RULES = `
id: after-element-call
language: TypeScript
rule:
  pattern:
    context: "const X = { after: [StageId($ARG)] }"
    selector: call_expression
  inside:
    kind: array
    stopBy: neighbor
    inside:
      all:
        - kind: pair
        - has: { field: key, regex: "^after$" }
      stopBy: neighbor
      inside:
        all:
          - kind: object
          - pattern: $REGOBJ
        stopBy: neighbor
        has:
          kind: pair
          stopBy: neighbor
          has:
            field: key
            regex: "^run$"
---
id: after-element-string
language: TypeScript
rule:
  kind: string
  inside:
    kind: array
    stopBy: neighbor
    inside:
      all:
        - kind: pair
        - has: { field: key, regex: "^after$" }
      stopBy: neighbor
      inside:
        all:
          - kind: object
          - pattern: $REGOBJ
        stopBy: neighbor
        has:
          kind: pair
          stopBy: neighbor
          has:
            field: key
            regex: "^run$"
---
id: after-element-propaccess
language: TypeScript
rule:
  pattern:
    context: "const X = { after: [$OBJ.$PROP] }"
    selector: member_expression
  inside:
    kind: array
    stopBy: neighbor
    inside:
      all:
        - kind: pair
        - has: { field: key, regex: "^after$" }
      stopBy: neighbor
      inside:
        all:
          - kind: object
          - pattern: $REGOBJ
        stopBy: neighbor
        has:
          kind: pair
          stopBy: neighbor
          has:
            field: key
            regex: "^run$"
---
id: after-element-identifier
language: TypeScript
rule:
  kind: identifier
  inside:
    kind: array
    stopBy: neighbor
    inside:
      all:
        - kind: pair
        - has: { field: key, regex: "^after$" }
      stopBy: neighbor
      inside:
        all:
          - kind: object
          - pattern: $REGOBJ
        stopBy: neighbor
        has:
          kind: pair
          stopBy: neighbor
          has:
            field: key
            regex: "^run$"
`

const AFTER_ARRAY_RULE = `
id: after-array
language: TypeScript
rule:
  kind: array
  inside:
    all:
      - kind: pair
      - has: { field: key, regex: "^after$" }
    stopBy: neighbor
    inside:
      all:
        - kind: object
        - pattern: $REGOBJ
      stopBy: neighbor
      has:
        kind: pair
        stopBy: neighbor
        has:
          field: key
          regex: "^run$"
`

/** Top-level comma count inside `[...]`, respecting nested brackets/braces/parens/strings. */
const arrayElementCount = (arrayText: string): number => {
  const inner = arrayText.trim().slice(1, -1).trim()
  if (inner.length === 0) return 0
  let depth = 0
  let count = 1
  let quote: string | undefined
  for (const char of inner) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
    } else if (char === ',' && depth === 0) {
      count += 1
    }
  }
  return count
}

/** Resolve an `id:`/`after:`-element match, in `resolve()`'s original priority order. */
const resolveMatch = (
  match: AstGrepMatch,
  ids: ReadonlyMap<string, { readonly id: string }>,
): string | undefined => {
  switch (match.ruleId) {
    case 'registration-id': {
      const value = match.metaVariables.single['VALUE']?.text
      if (value === undefined) return undefined
      const literal = /^StageId\(\s*((['"]).*\2)\s*\)$/u.exec(value)?.[1] ?? value
      return /^(['"]).*\1$/u.test(literal) ? unquote(literal) : ids.get(value)?.id
    }
    case 'after-element-call': {
      const arg = match.metaVariables.single['ARG']?.text
      return arg !== undefined && /^(['"]).*\1$/u.test(arg) ? unquote(arg) : undefined
    }
    case 'after-element-string':
      return unquote(match.text)
    case 'after-element-propaccess': {
      const obj = match.metaVariables.single['OBJ']?.text
      const prop = match.metaVariables.single['PROP']?.text
      return obj === undefined || prop === undefined ? undefined : ids.get(`${obj}.${prop}`)?.id
    }
    case 'after-element-identifier':
      return ids.get(match.text)?.id
    default:
      return undefined
  }
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
  io?: Pick<Io, 'readFile'>,
): { readonly stages: ReadonlyArray<ParsedStage>; readonly unresolved: ReadonlyArray<string> } => {
  if (io !== undefined) {
    const factoryParsed = parseFactoryRegistrations(filePath, text, io)
    if (factoryParsed !== undefined) return factoryParsed
  }
  const idMatches = runAstGrep(ID_RULES, text)
  const afterElementMatches = runAstGrep(AFTER_ELEMENT_RULES, text)
  const afterArrayMatches = runAstGrep(AFTER_ARRAY_RULE, text)
  const unresolved: Array<string> = []

  // Every registration object is identified by its `$REGOBJ` byte range,
  // shared across all three rule sets above. Elements matched, `run` already
  // verified present per-rule via `registrationObjectHasRun`, so an object's
  // presence in `idMatches` is what defines "this is a registration".
  const afterByRegObj = new Map<string, Array<AstGrepMatch>>()
  for (const match of afterElementMatches) {
    const regObjRange = match.metaVariables.single['REGOBJ']?.range.byteOffset
    if (regObjRange === undefined) continue
    const key = byteRangeKey(regObjRange)
    const list = afterByRegObj.get(key)
    if (list === undefined) afterByRegObj.set(key, [match])
    else list.push(match)
  }
  const afterArrayByRegObj = new Map<string, AstGrepMatch>()
  for (const match of afterArrayMatches) {
    const regObjRange = match.metaVariables.single['REGOBJ']?.range.byteOffset
    if (regObjRange === undefined) continue
    afterArrayByRegObj.set(byteRangeKey(regObjRange), match)
  }

  // Source order: by the `id` pair's own byte offset, matching the order
  // `ts.forEachChild` used to visit the tree.
  const orderedIdMatches = [...idMatches].sort(
    (left, right) => left.range.byteOffset.start - right.range.byteOffset.start,
  )

  const stages: Array<ParsedStage> = []
  for (const idMatch of orderedIdMatches) {
    const regObjKey = idMatch.metaVariables.single['REGOBJ']?.range.byteOffset
    if (regObjKey === undefined) continue
    const regObjKeyString = byteRangeKey(regObjKey)

    const id = resolveMatch(idMatch, ids)
    if (id === undefined) {
      unresolved.push(`${filePath}:${String(oneBasedLine(idMatch))} — cannot resolve the \`id\``)
      continue
    }

    const elementMatches = (afterByRegObj.get(regObjKeyString) ?? [])
      .slice()
      .sort((left, right) => left.range.byteOffset.start - right.range.byteOffset.start)
    const after: Array<string> = []
    for (const elementMatch of elementMatches) {
      const edge = resolveMatch(elementMatch, ids)
      if (edge === undefined) {
        unresolved.push(
          `${filePath}:${String(oneBasedLine(elementMatch))} — cannot resolve an \`after\` edge`,
        )
      } else {
        after.push(edge)
      }
    }

    // A form none of the four rules above recognises (a template literal, a
    // spread, a parenthesized or computed expression) leaves a gap between
    // the array's real element count and how many this file matched. Fail
    // loud at the array's own line rather than silently short the `after`
    // list — see the module header.
    const arrayMatch = afterArrayByRegObj.get(regObjKeyString)
    if (arrayMatch !== undefined) {
      const expectedCount = arrayElementCount(arrayMatch.text)
      if (expectedCount > elementMatches.length) {
        unresolved.push(
          `${filePath}:${String(oneBasedLine(arrayMatch))} — cannot resolve an \`after\` edge ` +
            '(unrecognised element form)',
        )
      }
    }

    stages.push({ id, after, declaredAtLine: oneBasedLine(idMatch) })
  }

  return { stages, unresolved }
}

const parseFactoryRegistrations = (
  filePath: string,
  text: string,
  io: Pick<Io, 'readFile'>,
): { readonly stages: ReadonlyArray<ParsedStage>; readonly unresolved: ReadonlyArray<string> } | undefined => {
  const read = sourceReader((file) => file === filePath ? text : io.readFile(file))
  const source = read(filePath)
  const candidates = source.nodes.filter((node) => kindOf(node) === 'pair' && node.metaVariables.single['KEY']?.text === 'frameStages')
  const moduleRoots = candidates.filter((node) => source.nodes.some((binding) => kindOf(binding) === 'binding' && /Module$/u.test(binding.metaVariables.single['NAME']?.text ?? '') && contains(binding, node)))
  const roots = moduleRoots.length === 0 ? candidates : moduleRoots
  if (roots.length === 0) return undefined
  if (roots.length !== 1) return { stages: [], unresolved: [`${filePath} - cannot identify one module frameStages root`] }
  const stages: Array<ParsedStage> = []
  const unresolved: Array<string> = []
  const visit = (expression: Expression, visited: ReadonlySet<string>): void => {
    const result = factoryResult(expression, read, visited)
    const key = expressionKey(result)
    if (visited.has(key)) throw new Error(`cyclic stage array: ${result.ref.text}`)
    const next = new Set([...visited, key])
    if (kindOf(nodeOf(result)) === 'array') {
      for (const item of itemsOf(result)) visit(item, next)
      return
    }
    const properties = objectProperties(result, read, visited)
    const idExpression = properties.get('id')
    if (idExpression === undefined || !properties.has('run')) throw new Error('factory does not return a stage registration')
    const id = mintedId(idExpression, read).id
    const after: Array<string> = []
    const afterExpression = properties.get('after')
    if (afterExpression !== undefined) {
      const edges = resolveExpression(afterExpression, read)
      if (edges === 'StageId' || kindOf(nodeOf(edges)) !== 'array') throw new Error('cannot resolve an `after` array')
      for (const edge of itemsOf(edges)) after.push(mintedId(edge, read).id)
    }
    stages.push({ id, after, declaredAtLine: oneBasedLine(idExpression.ref), declaredAtFile: idExpression.source.file })
  }
  for (const root of roots) {
    try {
      visit({ source, ref: root.metaVariables.single['VALUE']! }, new Set())
    } catch (cause) {
      unresolved.push(`${filePath}:${String(oneBasedLine(root))} - cannot resolve stage factory: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
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
  const idsPath = path.join(root, module.name, 'src', 'stages', 'stage-ids.ts')
  const registrationPath = path.join(root, module.name, 'src', 'stages', 'registration.ts')

  const idsText = io.readFile(idsPath)
  const registrationText = io.readFile(registrationPath)
  if (idsText === undefined || registrationText === undefined) {
    return [
      `${module.name}: the manifest says it registers ${String(module.stages.length)} stage(s), but ` +
        `${idsText === undefined ? 'stages/stage-ids.ts' : 'stages/registration.ts'} does not exist.`,
    ]
  }

  const ids = parseStageIds(idsPath, idsText)
  const parsed = parseRegistrations(registrationPath, registrationText, ids, io)
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
    const declaredFile = onDisk?.declaredAtFile === undefined
      ? `${module.name}/src/stages/registration.ts`
      : path.relative(root, onDisk.declaredAtFile).split(path.sep).join('/')
    const expectedDeclared = `${declaredFile}:${String(onDisk?.declaredAtLine ?? 0)}`
    const expectedMinted = `${module.name}/src/stages/stage-ids.ts:${String(mintedAt?.line ?? 0)}`

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
  const registrationPath = path.join(root, entry.name, 'src', 'stages', 'registration.ts')
  const text = io.readFile(registrationPath)
  if (text === undefined) {
    return []
  }
  const idsText = io.readFile(path.join(root, entry.name, 'src', 'stages', 'stage-ids.ts')) ?? ''
  const parsed = parseRegistrations(
    registrationPath,
    text,
    parseStageIds(path.join(root, entry.name, 'src', 'stages', 'stage-ids.ts'), idsText),
    io,
  )
  return [
    ...parsed.unresolved,
    ...(parsed.stages.length === 0 ? [] : [
        `${entry.name}: the manifest lists it under ROSTER_REGISTERS_NOTHING, but it now registers ` +
          `${parsed.stages.map((stage) => stage.id).join(', ')}. The frame has changed — re-read ` +
          'test/e2e/roster.ts and docs/testing.md §3.',
      ]),
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

const directoryExists = (at: string): boolean => {
  try {
    return statSync(at).isDirectory()
  } catch {
    return false
  }
}

const readFileIfPresent = (at: string): string | undefined =>
  existsSync(at) ? readFileSync(at, 'utf8') : undefined

export const main = (env: Record<string, string | undefined>): number => {
  const io: Io = {
    readFile: readFileIfPresent,
    directoryExists,
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
