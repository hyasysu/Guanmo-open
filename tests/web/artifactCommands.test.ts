import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }))
vi.mock('@/services/database/db', () => ({
  getDatabase: mocks.getDatabase,
  isDatabaseReady: () => false,
}))

import { buildReadingArtifactReferences } from '@/web/artifactCommands'

describe('Web reading artifact source references', () => {
  it('builds source snapshots without accessing desktop storage', () => {
    const sources = [{ kind: 'web' as const, title: 'Anonymous source', url: 'https://example.com/source' }]
    const references = buildReadingArtifactReferences(sources, [{
      title: 'Anonymous selection',
      text: 'Anonymous content',
      filePath: 'C:/anonymous/note.md',
      startLine: 2,
      endLine: 4,
      truncated: false,
      previewOnly: false,
    }])

    expect(references).toEqual([
      sources[0],
      { kind: 'local', filePath: 'C:/anonymous/note.md', fileName: 'note.md', startLine: 2, endLine: 4 },
    ])
    expect(mocks.getDatabase).not.toHaveBeenCalled()
  })
})
