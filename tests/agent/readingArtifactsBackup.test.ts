import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/services/database/db', () => ({
  isDatabaseReady: () => true,
  getDatabase: () => database,
}))

import { getReadingArtifactReferences, loadReadingArtifacts, loadReadingArtifactsForBackup } from '@/services/database/readingArtifacts'

describe('阅读成果来源数据库与备份读取', () => {
  beforeEach(() => {
    database.select.mockReset().mockResolvedValue([{
      id: 'artifact-1',
      type: 'summary',
      title: '匿名摘要',
      content: '匿名正文',
      structured_content: JSON.stringify({
        question: '匿名问题',
        references: [
          {
            kind: 'local',
            filePath: 'C:/anonymous/note.md',
            fileName: 'note.md',
            startLine: 2,
            endLine: 4,
          },
          {
            kind: 'web',
            title: '匿名网页',
            url: 'https://example.com/anonymous',
          },
        ],
      }),
      source_file_path: 'C:/anonymous/note.md',
      source_file_name: 'note.md',
      source_content_hash: 'hash-1',
      source_heading_path: null,
      source_start_line: 2,
      source_end_line: 4,
      source_quote: null,
      source_message_id: 'message-1',
      source_scope: 'workspace',
      status: 'active',
      created_at: 1700000000,
      updated_at: 1700000001,
    }])
  })

  it('数据库重新加载后完整解码 references', async () => {
    const [artifact] = await loadReadingArtifacts({ status: 'active' })
    expect(getReadingArtifactReferences(artifact)).toEqual([
      {
        kind: 'local',
        filePath: 'C:/anonymous/note.md',
        fileName: 'note.md',
        startLine: 2,
        endLine: 4,
      },
      {
        kind: 'web',
        title: '匿名网页',
        url: 'https://example.com/anonymous',
      },
    ])
  })

  it('备份条目保留完整 structuredContent 来源列表', async () => {
    const [entry] = await loadReadingArtifactsForBackup()
    expect(JSON.parse(entry.structuredContent || '{}')).toMatchObject({
      question: '匿名问题',
      references: [
        expect.objectContaining({ kind: 'local', fileName: 'note.md' }),
        expect.objectContaining({ kind: 'web', title: '匿名网页' }),
      ],
    })
  })
})
