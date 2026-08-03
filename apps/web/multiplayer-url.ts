export type MultiplayerUrlValidation =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly message: string }

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export const validateMultiplayerUrl = (
  value: string,
  pageUrl: string | URL,
): MultiplayerUrlValidation => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, message: 'Enter a valid multiplayer server URL.' }
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return { ok: false, message: 'Multiplayer server must use ws:// or wss://.' }
  }
  if (url.protocol === 'wss:') return { ok: true, url }

  const page = typeof pageUrl === 'string' ? new URL(pageUrl) : pageUrl
  if (page.protocol === 'https:') {
    return { ok: false, message: 'HTTPS pages require a secure wss:// multiplayer server.' }
  }
  if (
    page.protocol !== 'http:'
    || !isLoopbackHostname(page.hostname)
    || !isLoopbackHostname(url.hostname)
  ) {
    return {
      ok: false,
      message: 'ws:// is only allowed when both this page and the multiplayer server use a loopback address.',
    }
  }

  return { ok: true, url }
}
