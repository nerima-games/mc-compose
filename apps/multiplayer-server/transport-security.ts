export interface TransportSecurityInput {
  readonly host: string
  readonly tlsCert?: string
  readonly tlsKey?: string
  readonly allowedOrigins?: string
}

export type TransportSecurity =
  | {
      readonly secure: false
      readonly allowedOrigins: ReadonlySet<string>
    }
  | {
      readonly secure: true
      readonly tlsCert: string
      readonly tlsKey: string
      readonly allowedOrigins: ReadonlySet<string>
    }

export const isLoopbackHost = (host: string): boolean => {
  const normalized = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

const parseAllowedOrigins = (value: string | undefined): ReadonlySet<string> => {
  if (value === undefined) return new Set()
  const origins = value.split(',').map((origin) => origin.trim())
  if (origins.some((origin) => origin.length === 0)) {
    throw new Error('allowed-origins must contain only non-empty origins')
  }
  for (const origin of origins) {
    if (origin === 'null' || origin.includes('*')) throw new Error(`invalid allowed origin: ${origin}`)
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error(`invalid allowed origin: ${origin}`)
    }
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
      || origin !== parsed.origin
    ) throw new Error(`invalid allowed origin: ${origin}`)
  }
  return new Set(origins)
}

export const resolveTransportSecurity = (input: TransportSecurityInput): TransportSecurity => {
  const explicitlyConfigured = input.tlsCert !== undefined
    || input.tlsKey !== undefined
    || input.allowedOrigins !== undefined
  const secure = !isLoopbackHost(input.host) || explicitlyConfigured
  if (!secure) return { secure: false, allowedOrigins: new Set() }
  if (input.tlsCert === undefined || input.tlsCert.length === 0) {
    throw new Error('tls-cert is required for secure multiplayer transport')
  }
  if (input.tlsKey === undefined || input.tlsKey.length === 0) {
    throw new Error('tls-key is required for secure multiplayer transport')
  }
  const allowedOrigins = parseAllowedOrigins(input.allowedOrigins)
  if (allowedOrigins.size === 0) {
    throw new Error('allowed-origins must contain at least one HTTPS origin')
  }
  return {
    secure: true,
    tlsCert: input.tlsCert,
    tlsKey: input.tlsKey,
    allowedOrigins,
  }
}

export const isAllowedWebSocketOrigin = (
  origin: string | undefined,
  security: TransportSecurity,
): boolean => !security.secure || (origin !== undefined && security.allowedOrigins.has(origin))
