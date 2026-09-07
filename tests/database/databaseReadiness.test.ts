import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_DB_SCHEMA_VERSION } from '@/services/database/schema'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/hooks/useTauri', () => ({
  isTauri: () => true,
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mocks.load },
}))

import {
  closeDatabase,
  getDatabaseRuntimeState,
  initDatabase,
  waitForDatabaseReady,
} from '@/services/database/db'

describe('database readiness wait', () => {
  beforeEach(async () => {
    await closeDatabase()
    mocks.execute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    mocks.select.mockReset().mockImplementation(async (sql: string) => {
      if (sql === 'PRAGMA user_version') return [{ user_version: CURRENT_DB_SCHEMA_VERSION }]
      return []
    })
    mocks.close.mockReset().mockResolvedValue(undefined)
    mocks.load.mockReset()
  })

  afterEach(async () => {
    await closeDatabase()
  })

  it('waits when a consumer runs before database initialization starts', async () => {
    let resolveLoad: ((database: unknown) => void) | undefined
    mocks.load.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve }))

    const waiting = waitForDatabaseReady()
    const initializing = initDatabase()
    const earlyOutcome = await Promise.race([
      waiting.then(() => 'ready'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10)),
    ])

    expect(earlyOutcome).toBe('pending')
    expect(getDatabaseRuntimeState().status).toBe('initializing')

    resolveLoad?.({
      execute: mocks.execute,
      select: mocks.select,
      close: mocks.close,
    })

    await expect(initializing).resolves.toBeUndefined()
    await expect(waiting).resolves.toBeUndefined()
    expect(getDatabaseRuntimeState().status).toBe('ready')
  })

  it('rejects waiting consumers when database initialization fails', async () => {
    mocks.load.mockRejectedValue(new Error('cannot open database'))

    const initializing = initDatabase()
    const waiting = waitForDatabaseReady()

    await expect(initializing).rejects.toThrow('cannot open database')
    await expect(waiting).rejects.toThrow('cannot open database')
    expect(getDatabaseRuntimeState()).toMatchObject({
      status: 'error',
      error: 'cannot open database',
    })
  })
})
