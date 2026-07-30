import { decodeFrame, encodeFrame, type NetworkMessage, type PlayerId, type PlayerName } from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { startMultiplayerServer, type MultiplayerRuntime } from '../../apps/multiplayer-server/main'

const runtimes: Array<MultiplayerRuntime> = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})

const encode = (message: NetworkMessage): string => {
  const result = encodeFrame(message)
  if (Either.isLeft(result)) throw result.left
  return result.right
}

describe('multiplayer WebSocket runtime', () => {
  it('serves health and returns an authoritative snapshot after join', async () => {
    const runtime = await startMultiplayerServer({
      host: '127.0.0.1',
      port: 0,
      worldId: 'runtime-world',
      seed: 73,
      installSignalHandlers: false,
    })
    runtimes.push(runtime)

    const health = await fetch(`http://${runtime.host}:${String(runtime.port)}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok', world: 'runtime-world' })

    const snapshot = await new Promise<NetworkMessage>((resolve, reject) => {
      const socket = new WebSocket(`ws://${runtime.host}:${String(runtime.port)}/ws`)
      socket.once('error', reject)
      socket.once('open', () => {
        socket.send(encode({
          _tag: 'PlayerJoin',
          player: 'runtime-player' as PlayerId,
          name: 'Runtime Player' as PlayerName,
          at: { x: 2, y: 64, z: 3 },
        }))
      })
      socket.once('message', (data) => {
        const decoded = decodeFrame(data.toString() as never)
        socket.close()
        if (Either.isLeft(decoded)) reject(decoded.left)
        else resolve(decoded.right)
      })
    })

    expect(snapshot).toMatchObject({
      _tag: 'WorldSnapshot',
      world: 'runtime-world',
      seed: 73,
      players: [{ player: 'runtime-player', name: 'Runtime Player', at: { x: 2, y: 64, z: 3 } }],
    })
  })
})
