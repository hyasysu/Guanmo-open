// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DB_SCHEMA, DB_POST_MIGRATION_STATEMENTS, splitDatabaseSchemaStatements } from '@/services/database/schema'

const mocks = vi.hoisted(() => ({ web: false, database: null as unknown as { select: <T>(sql: string, params?: unknown[]) => Promise<T[]> }, invoke: vi.fn() }))
vi.mock('@/services/runtimeCapabilities', () => ({ isWebRuntime: () => mocks.web }))
vi.mock('@/services/database/db', () => ({ isDatabaseReady: () => true, getDatabase: () => mocks.database }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
import { loadReadingArtifactCenterItemsPage, loadReadingArtifactDocumentSummariesPage } from '@/services/database/readingArtifactCenter'
import { decodeArtifactOrganization, loadArtifactOrganization, setArtifactOrganization } from '@/services/database/artifactOrganization'

let sqlite: DatabaseSync
beforeEach(() => {
  mocks.web = false
  sqlite = new DatabaseSync(':memory:')
  for (const statement of splitDatabaseSchemaStatements(DB_SCHEMA)) sqlite.exec(statement)
  for (const statement of DB_POST_MIGRATION_STATEMENTS.filter((sql) => sql.includes('organization_delete'))) sqlite.exec(statement)
  mocks.database = { select: async <T,>(sql: string, params: unknown[] = []) => {
    const bindings = Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]))
    return sqlite.prepare(sql).all(bindings as Record<string, string | number>) as T[]
  } }
  sqlite.exec("INSERT INTO reading_artifact_categories VALUES ('c1', '主题一'), ('c2', '主题二')")
  for (let index = 0; index < 45; index++) {
    sqlite.prepare("INSERT INTO reading_artifacts (id, type, title, content, source_file_path, created_at, updated_at) VALUES (?, 'summary', '匿名摘要', '匿名正文', 'C:/anonymous/note.md', ?, ?)").run(`a${index}`, index, index)
  }
  sqlite.exec("INSERT INTO reading_artifact_organization VALUES ('ai:a0', 1, '[\"c1\",\"c2\"]'), ('ai:a1', 0, '[\"c2\"]')")
  sqlite.exec("INSERT INTO reading_marks (id, document_id, document_path, type, start_block_id, start_block_offset, end_block_id, end_block_offset, start_offset, end_offset, quote, color, created_at, updated_at) VALUES ('m1', 'path:c:/anonymous/note.md', 'C:/anonymous/note.md', 'highlight', 'b1', 0, 'b1', 1, 0, 1, '匿名', 'yellow', 100, 100)")
  sqlite.exec("INSERT INTO reading_artifact_organization VALUES ('mark:m1', 1, '[\"c1\"]')")
})
afterEach(() => sqlite.close())

const options = { view: 'recent' as const, types: ['summary', 'highlight'], limit: 40, offset: 0 }
describe('阅读成果收藏与分类 SQLite 查询', () => {
  it('筛选先于分页，能找到首屏之外的 AI 成果和人工成果', async () => {
    const all = await loadReadingArtifactCenterItemsPage(options)
    expect(all.artifacts.some((artifact) => artifact.id === 'a0')).toBe(false)
    const page = await loadReadingArtifactCenterItemsPage({ ...options, collection: 'favorites', categoryId: 'c1' })
    expect(page.total).toBe(2)
    expect(page.artifacts.map((artifact) => artifact.id)).toEqual(['a0'])
    expect(page.marks.map((mark) => mark.id)).toEqual(['m1'])
    const documents = await loadReadingArtifactDocumentSummariesPage({ ...options, collection: 'favorites', categoryId: 'c1' })
    expect(documents.documents[0]).toMatchObject({ total: 2, highlights: 1, aiArtifacts: 1 })
  })
  it('未分类包含没有整理记录的旧成果；分类可与搜索和文档筛选叠加', async () => {
    const unclassified = await loadReadingArtifactCenterItemsPage({ ...options, collection: 'unclassified' })
    expect(unclassified.total).toBe(43)
    const page = await loadReadingArtifactCenterItemsPage({ ...options, view: 'detail', documentPath: 'C:/anonymous/note.md', query: '匿名', categoryId: 'c2' })
    expect(page.total).toBe(2)
    expect(page.artifacts.map((artifact) => artifact.id)).toEqual(['a1', 'a0'])
    const injection = await loadReadingArtifactCenterItemsPage({ ...options, categoryId: "c1' OR 1=1 --" })
    expect(injection.total).toBe(0)
  })
  it('删除源成果仅清理对应整理信息，保留其他成果及分类', async () => {
    sqlite.exec("DELETE FROM reading_artifacts WHERE id = 'a0'; DELETE FROM reading_marks WHERE id = 'm1'")
    const snapshot = await loadArtifactOrganization()
    expect(snapshot.entries.map((entry) => entry.artifactKey)).toEqual(['ai:a1'])
    expect(snapshot.categories).toHaveLength(2)
  })
  it('拒绝损坏的整理数据，收藏命令只修改指定字段', async () => {
    expect(() => decodeArtifactOrganization({ artifact_key: 'ai:a0', favorite: 1, category_ids: '[1]' })).toThrow()
    await setArtifactOrganization('ai:a0', { favorite: false })
    expect(mocks.invoke).toHaveBeenCalledWith('set_reading_artifact_organization', { artifactKey: 'ai:a0', favorite: false, categoryIds: null })
  })
  it('Web 误调用拒绝整理能力，不发送原生写入', async () => {
    mocks.web = true
    await expect(setArtifactOrganization('ai:a0', { favorite: true })).rejects.toMatchObject({ name: 'UnsupportedCapabilityError' })
    await expect(loadArtifactOrganization()).rejects.toMatchObject({ name: 'UnsupportedCapabilityError' })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
