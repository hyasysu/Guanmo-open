import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  ready: false,
  waitForDatabaseReady: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@/services/database/db', () => ({
  isDatabaseReady: () => mocks.ready,
  waitForDatabaseReady: mocks.waitForDatabaseReady,
}))

vi.mock('@/services/runtimeCapabilities', () => ({
  isWebRuntime: () => false,
}))

import { loadReadingMarks, readingDocumentId } from '@/services/readingMarks'

describe('ReadingMark database readiness', () => {
  beforeEach(() => {
    mocks.ready = false
    mocks.invoke.mockReset().mockResolvedValue([])
    mocks.waitForDatabaseReady.mockReset().mockImplementation(async () => {
      mocks.ready = true
    })
  })

  it('waits for an initializing database instead of showing a not-ready startup error', async () => {
    await expect(loadReadingMarks('C:/Notes/startup.md')).resolves.toEqual([])

    expect(mocks.waitForDatabaseReady).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('load_reading_marks', {
      documentId: readingDocumentId('C:/Notes/startup.md'),
    })
  })
})
