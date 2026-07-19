import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeAgentStepEvent, decodeKnowledgeSearchOutcome } from '../src/services/agent/session'
import { decodeRagIndexState, decodeRagSearchResults } from '../src/services/rag/nativeIndex'

assert.deepEqual(decodeRagIndexState({
  status: 'ready',
  documentCount: 68,
  chunkCount: 4212,
  validVectorCount: 4210,
  skippedVectorCount: 2,
  error: null,
}), {
  status: 'ready',
  documentCount: 68,
  chunkCount: 4212,
  validVectorCount: 4210,
  skippedVectorCount: 2,
  error: undefined,
})
assert.throws(() => decodeRagIndexState({ status: 'ready' }), /documentCount/)

const [hit] = decodeRagSearchResults([{
  chunk: {
    id: 'chunk-1', documentId: 'doc-1', content: '索引内容', contentHash: 'hash',
    index: 0, startLine: 1, endLine: 2, titlePath: ['标题'], sourceType: 'markdown',
  },
  document: { id: 'doc-1', filePath: 'C:\\notes\\a.md', title: 'a.md', lastModified: 1 },
  score: 0.9, retrievalMode: 'hybrid', keywordScore: 0.8, vectorScore: 0.9,
}])
assert.equal(hit.document.content, '')
assert.equal(hit.document.chunks.length, 0)
assert.equal(hit.chunk.content, '索引内容')
assert.throws(() => decodeRagSearchResults([{ chunk: {}, document: {} }]), /fields/)

assert.equal(decodeAgentStepEvent({
  type: 'progress', content: 'rag_ready', progressStage: 'rag_ready', timestamp: 1,
}).type, 'progress')
assert.throws(() => decodeAgentStepEvent({
  type: 'progress', content: 'bad', timestamp: 1,
}), /progress event is invalid/)
assert.equal(decodeKnowledgeSearchOutcome(decodeAgentStepEvent({
  type: 'observation',
  toolName: 'search_knowledge',
  content: JSON.stringify({ status: 'ok', results: [{ filePath: 'C:\\notes\\a.md' }] }),
  timestamp: 2,
})), 'found')
assert.equal(decodeKnowledgeSearchOutcome(decodeAgentStepEvent({
  type: 'observation',
  toolName: 'search_knowledge',
  content: JSON.stringify({ status: 'empty', results: [] }),
  timestamp: 3,
})), 'empty')

const aiPanelSource = readFileSync('src/components/ai/AiPanel.tsx', 'utf8')
assert.equal(
  aiPanelSource.includes('<RagTrace status={ragStatus}'),
  false,
  'AI 助手顶部不应渲染重复的 RAG 状态横条',
)

console.log('Runtime schema checks passed: RAG state, TopK hits, and Agent progress events')
