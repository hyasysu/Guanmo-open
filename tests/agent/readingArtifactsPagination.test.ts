import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingArtifactRow, ReadingArtifactType } from '@/services/database/readingArtifacts'

const database = vi.hoisted(() => ({
  ready: true,
  select: vi.fn(),
}))

vi.mock('@/services/database/db', () => ({
  isDatabaseReady: () => database.ready,
  getDatabase: () => database,
}))

import { loadReadingArtifactsPage } from '@/services/database/readingArtifacts'

function createRow(id: string): ReadingArtifactRow {
  return {
    id,
    type: 'summary',
    title: `匿名摘要 ${id}`,
    content: `匿名正文 ${id}`,
    structured_content: JSON.stringify({
      question: `匿名问题 ${id}`,
      references: [{ kind: 'web', title: '匿名网页', url: 'https://example.com/anonymous' }],
    }),
    source_file_path: 'C:/anonymous/note.md',
    source_file_name: 'note.md',
    source_content_hash: null,
    source_heading_path: null,
    source_start_line: 1,
    source_end_line: 2,
    source_quote: '匿名来源标题',
    source_message_id: null,
    source_scope: 'document',
    status: 'active',
    created_at: 1_700_000_000,
    updated_at: 1_700_000_001,
  }
}

function mockPage(total: number, rows: ReadingArtifactRow[]): void {
  database.select
    .mockResolvedValueOnce([{ total }])
    .mockResolvedValueOnce(rows)
}

describe('阅读成果分页查询', () => {
  beforeEach(() => {
    database.ready = true
    database.select.mockReset()
  })

  it('默认返回 20 条分页结果与准确总数，并使用稳定排序', async () => {
    mockPage(21, [createRow('artifact-21')])

    const page = await loadReadingArtifactsPage()

    expect(page.total).toBe(21)
    expect(page.artifacts.map((artifact) => artifact.id)).toEqual(['artifact-21'])
    expect(database.select).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) AS total FROM reading_artifacts ',
      [],
    )
    expect(database.select).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT $1 OFFSET $2'),
      [20, 0],
    )
  })

  it.each([
    { limit: 1, offset: 0 },
    { limit: 20, offset: 20 },
    { limit: 21, offset: 40 },
  ])('保留 $limit 条页边界并规范化 offset', async ({ limit, offset }) => {
    mockPage(0, [])

    const page = await loadReadingArtifactsPage({ limit, offset })

    expect(page).toEqual({ artifacts: [], total: 0 })
    expect(database.select).toHaveBeenNthCalledWith(2, expect.any(String), [limit, offset])
  })

  it.each([0, 1, 20, 21])('解码并返回 $count 条数据库分页结果', async (count) => {
    const rows = Array.from({ length: count }, (_, index) => createRow(`artifact-${index + 1}`))
    mockPage(count, rows)

    const page = await loadReadingArtifactsPage({ limit: 100 })

    expect(page.total).toBe(count)
    expect(page.artifacts).toHaveLength(count)
  })

  it.each<ReadingArtifactType>(['summary', 'question_set', 'annotation', 'note'])(
    '参数化查询 %s 类型',
    async (type) => {
      mockPage(0, [])

      await loadReadingArtifactsPage({ type })

      expect(database.select).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('WHERE type = $1'),
        [type],
      )
      expect(database.select).toHaveBeenNthCalledWith(2, expect.any(String), [type, 20, 0])
    },
  )

  it.each(['中文关键词', 'Archive'])('参数化查询中文或英文关键词：%s', async (query) => {
    mockPage(0, [])

    await loadReadingArtifactsPage({ query })

    expect(database.select).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("structured_content, '') LIKE $1 ESCAPE '!'"),
      [`%${query}%`],
    )
    expect(database.select).toHaveBeenNthCalledWith(2, expect.any(String), [`%${query}%`, 20, 0])
  })

  it('组合类型、状态与关键词，并让列表和计数复用相同条件', async () => {
    mockPage(1, [createRow('artifact-match')])

    await loadReadingArtifactsPage({
      type: 'note',
      status: 'active',
      query: '  广东%_!  ',
      limit: 999,
      offset: -1,
    })

    const [countSql, countParams] = database.select.mock.calls[0] as [string, unknown[]]
    const [pageSql, pageParams] = database.select.mock.calls[1] as [string, unknown[]]
    expect(countSql).toContain('type = $1 AND status = $2')
    expect(countSql).toContain("title LIKE $3 ESCAPE '!'")
    expect(countSql).toContain("content LIKE $3 ESCAPE '!'")
    expect(countSql).toContain("source_file_name, '') LIKE $3 ESCAPE '!'")
    expect(countSql).toContain("source_quote, '') LIKE $3 ESCAPE '!'")
    expect(countSql).toContain("structured_content, '') LIKE $3 ESCAPE '!'")
    expect(countParams).toEqual(['note', 'active', '%广东!%!_!!%'])
    expect(pageSql.slice(pageSql.indexOf('WHERE'), pageSql.indexOf(' ORDER BY')))
      .toBe(countSql.slice(countSql.indexOf('WHERE')))
    expect(pageParams).toEqual(['note', 'active', '%广东!%!_!!%', 100, 0])
  })

  it('空白关键词等同未搜索，并对无效分页参数使用安全默认值', async () => {
    mockPage(0, [])

    await loadReadingArtifactsPage({ query: '   ', limit: Number.NaN, offset: Number.POSITIVE_INFINITY })

    const [countSql, countParams] = database.select.mock.calls[0] as [string, unknown[]]
    const [pageSql, pageParams] = database.select.mock.calls[1] as [string, unknown[]]
    expect(countSql).not.toContain('LIKE')
    expect(pageSql).not.toContain('LIKE')
    expect(countParams).toEqual([])
    expect(pageParams).toEqual([20, 0])
  })

  it('数据库未就绪时返回空页且不发起查询', async () => {
    database.ready = false

    await expect(loadReadingArtifactsPage({ query: '匿名' })).resolves.toEqual({
      artifacts: [],
      total: 0,
    })
    expect(database.select).not.toHaveBeenCalled()
  })

  it('保持损坏 structured_content 的既有可见报错语义', async () => {
    const brokenRow = createRow('artifact-broken')
    brokenRow.structured_content = '{invalid-json'
    mockPage(1, [brokenRow])

    await expect(loadReadingArtifactsPage()).rejects.toThrow('reading_artifacts.structured_content 解析失败')
  })
})
