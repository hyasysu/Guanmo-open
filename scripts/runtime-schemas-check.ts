import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeAgentStepEvent, decodeKnowledgeSearchOutcome } from '../src/services/agent/session'
import { buildPendingActionResult, decodePendingAction } from '../src/services/agent/actionProposal'
import { decodeRagIndexState, decodeRagSearchResults } from '../src/services/rag/nativeIndex'
import { decodeReadingArtifact, decodeAnnotationStructuredContent } from '../src/services/database/readingArtifacts'

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

const pendingAction = decodePendingAction(JSON.parse(buildPendingActionResult(
  'create_markdown_note',
  { title: '匿名笔记', content: '正文' },
  { title: '新建 Markdown 阅读笔记', target: '系统保存对话框', preview: '匿名笔记' },
)))
assert.equal(pendingAction?.kind, 'create_markdown_note')
assert.throws(
  () => decodePendingAction({ __pendingAction: true, kind: 'run_shell', payload: {} }),
  /未注册/,
  '未注册动作不得进入 store 或执行器',
)
assert.throws(
  () => buildPendingActionResult(
    'create_markdown_note',
    { title: '匿名笔记', content: '正文', path: 'C:/forbidden.md' },
    { title: '新建 Markdown 阅读笔记', target: '系统保存对话框', preview: '匿名笔记' },
  ),
  /未注册字段 path/,
  '文件行动提案不得接受任意路径',
)

const aiPanelSource = readFileSync('src/components/ai/AiPanel.tsx', 'utf8')
assert.equal(
  aiPanelSource.includes('<RagTrace status={ragStatus}'),
  false,
  'AI 助手顶部不应渲染重复的 RAG 状态横条',
)

// reading_artifacts 运行时解码：未知类型/损坏数据进入可见错误，不静默丢弃
const decodedArtifact = decodeReadingArtifact({
  id: 'artifact-runtime',
  type: 'summary',
  title: '匿名摘要',
  content: '正文',
  structured_content: '{"points":["要点"]}',
  source_file_path: 'C:/anonymous/note.md',
  source_file_name: 'note.md',
  source_content_hash: 'hash-rt',
  source_heading_path: '["章节"]',
  source_start_line: 2,
  source_end_line: 4,
  source_quote: '引用快照',
  source_message_id: 'message-rt',
  source_scope: 'document',
  status: 'active',
  created_at: 1700000000,
  updated_at: 1700000001,
})
assert.equal(decodedArtifact.type, 'summary')
assert.equal(decodedArtifact.source?.headingPath?.[0], '章节')
assert.equal(decodedArtifact.source?.scope, 'document')
assert.deepEqual(decodedArtifact.structuredContent, { points: ['要点'] })
assert.throws(
  () => decodeReadingArtifact({ ...decodedArtifact, type: 'unknown_type' } as never),
  /类型/,
  '未知阅读成果类型必须抛出可见错误',
)
assert.throws(
  () => decodeReadingArtifact({
    id: 'bad',
    type: 'note',
    title: 't',
    content: 'c',
    structured_content: '{broken',
    source_file_path: null,
    source_file_name: null,
    source_content_hash: null,
    source_heading_path: null,
    source_start_line: null,
    source_end_line: null,
    source_quote: null,
    source_message_id: null,
    source_scope: null,
    status: 'active',
    created_at: 1,
    updated_at: 1,
  }),
  /structured_content/,
  '损坏的结构化数据必须抛出可见错误',
)

// 批注结构化解码：quote/note 必填，损坏数据抛出可见错误，不静默丢弃
const decodedAnnotation = decodeAnnotationStructuredContent({
  quote: '被批注的原文',
  note: '批注正文',
  contextFingerprint: 'fp',
  startOffset: 10,
  endOffset: 20,
})
assert.equal(decodedAnnotation.quote, '被批注的原文')
assert.equal(decodedAnnotation.note, '批注正文')
assert.equal(decodedAnnotation.startOffset, 10)
assert.throws(
  () => decodeAnnotationStructuredContent({ note: '缺 quote' }),
  /quote/,
  '批注缺 quote 必须抛出可见错误',
)

console.log('Runtime schema checks passed: RAG state, TopK hits, Agent progress events, and reading artifacts')
