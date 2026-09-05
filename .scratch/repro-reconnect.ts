// Standalone reproduction, no Playwright/Chromium involved: connects a raw
// WebSocket client directly to a fresh multiplayer-server instance, repeats
// connect/disconnect/reconnect with the SAME player id back-to-back, and
// measures how often the reconnect is rejected. This isolates whether the
// e2e "connecting -> closed" failure is a server-side race independent of
// any browser/Playwright teardown timing.
import { spawn, type ChildProcess } from 'node:child_process'
import { Either } from 'effect'
import { WebSocket } from 'ws'
import { encodeFrame, type NetworkMessage } from '@nerima-games/mx-multiplayer'

type WireMessage = { readonly _tag: string; readonly [key: string]: unknown }

const encode = (message: NetworkMessage): string => {
  const result = encodeFrame(message)
  if (Either.isLeft(result)) throw result.left
  return result.right
}

const startServer = (): Promise<{ process: ChildProcess; url: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--import', 'tsx/esm',
      'apps/multiplayer-server/main.ts',
      '--host', '127.0.0.1',
      '--port', '0',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`server start timed out: ${stderr}`))
    }, 10_000)
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited ${String(code)}: ${stderr}`)) })
    child.stdout?.on('data', (chunk: Buffer) => {
      const match = /multiplayer server listening on (ws:\/\/[^\s]+)/.exec(chunk.toString())
      if (match?.[1] === undefined) return
      clearTimeout(timeout)
      resolve({ process: child, url: match[1] })
    })
  })

const stopServer = (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000)
    child.once('exit', () => { clearTimeout(forceKill); resolve() })
    child.kill('SIGTERM')
  })
}

type AttemptResult =
  | { readonly ok: true; readonly socket: WebSocket; readonly ms: number; readonly token: string }
  | { readonly ok: false; readonly reason: string; readonly ms: number }

const connectOnce = (url: string, player: string, resumeToken?: string): Promise<AttemptResult> => new Promise((resolve) => {
  const start = performance.now()
  const socket = new WebSocket(url)
  let settled = false
  const finish = (result: AttemptResult): void => {
    if (settled) return
    settled = true
    socket.off('message', onMessage)
    socket.off('close', onClose)
    socket.off('error', onError)
    resolve(result)
  }
  const onClose = (code: number, reason: Buffer): void => {
    finish({ ok: false, reason: `closed ${String(code)}: ${reason.toString()}`, ms: performance.now() - start })
  }
  const onError = (error: Error): void => {
    finish({ ok: false, reason: `error: ${error.message}`, ms: performance.now() - start })
  }
  let stage: 'resume' | 'join' = 'resume'
  const onMessage = (data: Buffer): void => {
    const frame = JSON.parse(data.toString()) as WireMessage & { readonly message?: WireMessage }
    const message = frame.message ?? frame
    if (process.env['REPRO_VERBOSE'] === '1') {
      process.stdout.write(`  [${player}] <- ${JSON.stringify(message)}\n`)
    }
    if (stage === 'resume') {
      if (message._tag !== 'PlayerResumeAccepted') {
        finish({ ok: false, reason: `unexpected resume reply ${message._tag}`, ms: performance.now() - start })
        return
      }
      const issuedToken = message['token']
      stage = 'join'
      socket.send(encode({
        _tag: 'PlayerJoin',
        player,
        name: 'Repro Player',
        at: { x: 0, y: 64, z: 0 },
      } as NetworkMessage))
      ;(socket as unknown as { __issuedToken?: string }).__issuedToken = typeof issuedToken === 'string' ? issuedToken : undefined
      return
    }
    if (message._tag === 'WorldSnapshot') {
      const issuedToken = (socket as unknown as { __issuedToken?: string }).__issuedToken
      finish({ ok: true, socket, ms: performance.now() - start, token: issuedToken ?? '' })
      return
    }
  }
  socket.on('message', onMessage)
  socket.on('close', onClose)
  socket.on('error', onError)
  socket.once('open', () => {
    socket.send(JSON.stringify({
      _tag: 'PlayerResume',
      player,
      ...(resumeToken === undefined ? {} : { token: resumeToken }),
    }))
  })
})

const disconnectAbrupt = (socket: WebSocket): void => {
  socket.terminate()
}

const disconnectClean = (socket: WebSocket, player: string): void => {
  const frame = encode({ _tag: 'PlayerLeave', player } as NetworkMessage)
  if (process.env['REPRO_VERBOSE'] === '1') process.stdout.write(`  [${player}] -> ${frame}\n`)
  socket.send(frame)
  socket.close(1000, 'left')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const runTrial = async (
  url: string,
  label: string,
  disconnectFn: (socket: WebSocket, player: string) => void,
  gapMs: number,
  iterations: number,
): Promise<void> => {
  let successes = 0
  let failures = 0
  const failureReasons: string[] = []
  const rejectMs: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    // A FRESH player id per iteration: reusing one across a whole trial made
    // a single stuck failure poison every later iteration regardless of gap,
    // which is not what gap-dependence is meant to measure.
    const player = `repro-${label}-${String(gapMs)}ms-${String(i)}`
    const first = await connectOnce(url, player)
    if (!first.ok) {
      failures += 1
      failureReasons.push(`initial-connect: ${first.reason}`)
      continue
    }
    disconnectFn(first.socket, player)
    if (gapMs > 0) await sleep(gapMs)
    const second = await connectOnce(url, player)
    if (second.ok) {
      successes += 1
      second.socket.close(1000, 'trial done')
    } else {
      failures += 1
      failureReasons.push(second.reason)
      rejectMs.push(second.ms)
    }
  }
  const rejectSummary = rejectMs.length > 0
    ? ` reject-latency ms: [${rejectMs.map((n) => n.toFixed(1)).join(', ')}]`
    : ''
  process.stdout.write(
    `${label} gap=${String(gapMs)}ms: ${String(successes)}/${String(iterations)} reconnect ok, `
    + `${String(failures)}/${String(iterations)} failed.${rejectSummary}\n`
    + (failureReasons.length > 0 ? `  reasons: ${JSON.stringify(failureReasons)}\n` : ''),
  )
}

// Isolates whether the rejection is about SOCKET/CONNECTION state (activePlayers
// / reservedPlayers not yet cleared) or about AUTHENTICATION mode (a same-name
// rejoin with no resume token is only accepted via the legacy-claims path).
// Control A: rejoin with the actual token issued on the first connect — should
// succeed if the mechanism is auth-mode, not connection-state.
// Control B: rejoin with a never-used player id and NO token at all (a true
// first-ever join) — should always succeed, proving fresh identities are fine.
const runTokenTrial = async (url: string, iterations: number): Promise<void> => {
  let successes = 0
  let failures = 0
  const reasons: string[] = []
  for (let i = 0; i < iterations; i += 1) {
    const player = `repro-token-${String(i)}`
    const first = await connectOnce(url, player)
    if (!first.ok) {
      failures += 1
      reasons.push(`initial-connect: ${first.reason}`)
      continue
    }
    const token = first.token
    disconnectAbrupt(first.socket)
    const second = await connectOnce(url, player, token)
    if (second.ok) {
      successes += 1
      second.socket.close(1000, 'trial done')
    } else {
      failures += 1
      reasons.push(second.reason)
    }
  }
  process.stdout.write(
    `token-reconnect: ${String(successes)}/${String(iterations)} ok, ${String(failures)}/${String(iterations)} failed.\n`
    + (reasons.length > 0 ? `  reasons: ${JSON.stringify(reasons)}\n` : ''),
  )
}

const runFreshIdTrial = async (url: string, iterations: number): Promise<void> => {
  let successes = 0
  let failures = 0
  const reasons: string[] = []
  for (let i = 0; i < iterations; i += 1) {
    const player = `repro-fresh-${String(Date.now())}-${String(i)}`
    const attempt = await connectOnce(url, player)
    if (attempt.ok) {
      successes += 1
      attempt.socket.close(1000, 'trial done')
    } else {
      failures += 1
      reasons.push(attempt.reason)
    }
  }
  process.stdout.write(
    `fresh-id-first-join: ${String(successes)}/${String(iterations)} ok, ${String(failures)}/${String(iterations)} failed.\n`
    + (reasons.length > 0 ? `  reasons: ${JSON.stringify(reasons)}\n` : ''),
  )
}

const main = async (): Promise<void> => {
  const server = await startServer()
  process.stdout.write(`server up at ${server.url}\n`)
  try {
    await runFreshIdTrial(server.url, 10)
    await runTokenTrial(server.url, 10)
    await runTrial(server.url, 'abrupt-no-token', disconnectAbrupt, 0, 10)
  } finally {
    await stopServer(server.process)
  }
}

await main()
