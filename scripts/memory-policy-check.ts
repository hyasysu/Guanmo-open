import { strict as assert } from 'node:assert'
import {
  classifyMemoryRetrievalIntent,
  contentHash,
  filterInjectableMemories,
  findActiveFactConflict,
  hasReusableEmbedding,
  inferMemoryScope,
  isMemoryVisibleInScope,
  normalizeMemoryScopeKey,
  shouldExtractMemoryCandidate,
} from '../src/services/memory/memoryPolicy'
import { DB_MIGRATIONS, DB_SCHEMA } from '../src/services/database/schema'

assert.equal(classifyMemoryRetrievalIntent('你还记得我的偏好吗'), 'strong')
assert.equal(classifyMemoryRetrievalIntent('按照上次的方案继续'), 'weak')
assert.equal(classifyMemoryRetrievalIntent('帮我总结这段文字'), 'none')
assert.equal(normalizeMemoryScopeKey('project', 'D:\\React\\观墨\\'), 'd:/react/观墨')
assert.deepEqual(inferMemoryScope('preference', 'D:\\React\\观墨'), { scopeType: 'global', scopeKey: null })
assert.deepEqual(inferMemoryScope('project', 'D:\\React\\观墨'), { scopeType: 'project', scopeKey: 'd:/react/观墨' })
assert.equal(contentHash('稳定内容'), contentHash('稳定内容'))

const globalMemory = { id: 'global', content: '全局', status: 'active', scopeType: 'global' as const }
const projectMemory = { id: 'project', content: '项目', status: 'active', scopeType: 'project' as const, scopeKey: 'd:/react/观墨' }
assert.equal(isMemoryVisibleInScope(globalMemory, null), true)
assert.equal(isMemoryVisibleInScope(globalMemory, 'D:\\Other'), true)
assert.equal(isMemoryVisibleInScope(projectMemory, null), false)
assert.equal(isMemoryVisibleInScope(projectMemory, 'D:\\React\\观墨\\'), true)
assert.equal(isMemoryVisibleInScope(projectMemory, 'D:\\React\\Other'), false)

assert.deepEqual(
  filterInjectableMemories([
    globalMemory,
    { ...projectMemory, id: 'candidate', status: 'candidate' },
    { ...projectMemory, id: 'ignored', status: 'ignored' },
    { ...projectMemory, id: 'archived', status: 'archived' },
    { ...projectMemory, id: 'superseded', status: 'superseded' },
    { ...projectMemory, id: 'replacement', supersedesId: 'global' },
  ]).map((memory) => memory.id),
  ['replacement']
)
assert.equal(findActiveFactConflict([
  { ...projectMemory, subject: 'user', factKey: 'theme' },
  { ...globalMemory, subject: 'user', factKey: 'theme' },
], { subject: 'user', factKey: 'theme', scopeType: 'project', scopeKey: 'd:/react/观墨' })?.id, 'project')
assert.equal(findActiveFactConflict([
  { ...projectMemory, subject: 'user', factKey: 'theme' },
], { subject: 'user', factKey: 'theme', scopeType: 'project', scopeKey: 'd:/react/other' }), undefined)

assert.equal(shouldExtractMemoryCandidate('我喜欢简洁的回答'), true)
assert.equal(shouldExtractMemoryCandidate('今天我喜欢喝咖啡'), false)
assert.equal(shouldExtractMemoryCandidate('把“我喜欢蓝色”翻译成英文'), false)
assert.equal(shouldExtractMemoryCandidate('虚构一个我是工程师的故事'), false)
assert.equal(shouldExtractMemoryCandidate('记住：我喜欢蓝色'), true)

const cached = { content: '稳定内容', contentHash: contentHash('稳定内容'), embedding: [1, 0], embeddingModel: 'model-a' }
assert.equal(hasReusableEmbedding(cached, 'model-a'), true)
assert.equal(hasReusableEmbedding({ ...cached, content: '内容已变' }, 'model-a'), false)
assert.equal(hasReusableEmbedding(cached, 'model-b'), false)
assert.equal(hasReusableEmbedding({ ...cached, embedding: null }, 'model-a'), false)

const requiredMemoryColumns = [
  'scope_type', 'scope_key', 'subject', 'fact_key', 'fact_value', 'confidence',
  'evidence', 'supersedes_id', 'embedding', 'embedding_model', 'content_hash',
]
for (const column of requiredMemoryColumns) {
  assert.match(DB_SCHEMA, new RegExp(`\\b${column}\\b`), `base schema missing ${column}`)
  assert.equal(
    DB_MIGRATIONS.some((migration) => migration.table === 'memories' && migration.column === column),
    true,
    `legacy migration missing ${column}`
  )
}
assert.match(DB_SCHEMA, /scope_type TEXT NOT NULL DEFAULT 'global'/)
assert.match(DB_SCHEMA, /confidence REAL NOT NULL DEFAULT 1/)
console.log('memory policy checks passed')
