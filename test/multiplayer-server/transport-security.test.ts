import { describe, expect, it } from 'vitest'

import {
  isAllowedWebSocketOrigin,
  isLoopbackHost,
  resolveTransportSecurity,
} from '../../apps/multiplayer-server/transport-security'
import { resolveMultiplayerRuntimeOptions } from '../../apps/multiplayer-server/main'

describe('multiplayer transport security', () => {
  it('preserves unencrypted compatibility only for loopback hosts without security options', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true)
      expect(resolveTransportSecurity({ host })).toEqual({ secure: false, allowedOrigins: new Set() })
    }
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
  })

  it('requires complete TLS and origin configuration for non-loopback or explicit security', () => {
    expect(() => resolveTransportSecurity({ host: '0.0.0.0' })).toThrow(/tls-cert/)
    expect(() => resolveTransportSecurity({ host: '127.0.0.1', tlsCert: 'cert.pem' })).toThrow(/tls-key/)
    expect(() => resolveTransportSecurity({ host: '127.0.0.1', tlsCert: 'cert.pem', tlsKey: 'key.pem' })).toThrow(/allowed-origins/)
  })

  it('resolves TLS options from CLI before environment variables', () => {
    const options = resolveMultiplayerRuntimeOptions([
      '--tls-cert', 'cli-cert.pem',
      '--tls-key=cli-key.pem',
      '--allowed-origins', 'https://cli.example',
    ], {
      MULTIPLAYER_TLS_CERT: 'env-cert.pem',
      MULTIPLAYER_TLS_KEY: 'env-key.pem',
      MULTIPLAYER_ALLOWED_ORIGINS: 'https://env.example',
    })
    expect(options).toMatchObject({
      tlsCert: 'cli-cert.pem',
      tlsKey: 'cli-key.pem',
      allowedOrigins: 'https://cli.example',
    })
  })

  it('accepts only exact canonical HTTPS origins', () => {
    const security = resolveTransportSecurity({
      host: '0.0.0.0',
      tlsCert: 'cert.pem',
      tlsKey: 'key.pem',
      allowedOrigins: 'https://game.example, https://game.example:8443',
    })
    expect(isAllowedWebSocketOrigin('https://game.example', security)).toBe(true)
    expect(isAllowedWebSocketOrigin('https://game.example:8443', security)).toBe(true)
    expect(isAllowedWebSocketOrigin(undefined, security)).toBe(false)
    expect(isAllowedWebSocketOrigin('https://evil.example', security)).toBe(false)
  })

  it.each([
    'http://game.example',
    'https://game.example/',
    'https://user@game.example',
    'https://game.example/path',
    'https://game.example?query=1',
    'https://game.example#fragment',
    'https://*.example',
    'null',
  ])('rejects invalid allowed origin %s', (origin) => {
    expect(() => resolveTransportSecurity({
      host: '0.0.0.0',
      tlsCert: 'cert.pem',
      tlsKey: 'key.pem',
      allowedOrigins: origin,
    })).toThrow(/origin/)
  })
})
