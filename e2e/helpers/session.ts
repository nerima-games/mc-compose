import type { Page } from '@playwright/test'

export const E2E_SESSION_ID = 'e2e'

export const startGameSession = (
  page: Page,
  sessionId: string = E2E_SESSION_ID,
): Promise<unknown> => page.goto(`/?${new URLSearchParams({
  session: sessionId,
  create: '1',
  name: sessionId,
  mode: 'survival',
}).toString()}`)
