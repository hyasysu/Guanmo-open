import { describe, expect, it } from 'vitest'
import { buildContext, buildContextResult } from '@/services/rag/pipeline'
import type { SearchResult } from '@/services/rag/types'

function createResult(index: number, content: string): SearchResult {
  const filePath = `C:\\workspace\\note-${index}.md`
  const chunk = {
    id: `chunk-${index}`,
    documentId: `document-${index}`,
    content,
    index: index - 1,
    startLine: index * 10,
    endLine: index * 10 + content.split('\n').length - 1,
    titlePath: ['章节', `条目 ${index}`],
  }
  return {
    chunk,
    score: 1 - index / 10,
    retrievalMode: index % 2 === 0 ? 'keyword' : 'hybrid',
    document: {
      id: `document-${index}`,
      filePath,
      title: `笔记 ${index}`,
      content,
      lastModified: index,
      chunks: [chunk],
    },
  }
}

describe('RAG context packing', () => {
  it('counts the complete rendered context and accepts an exact boundary', () => {
    const result = createResult(1, '完整内容')
    const full = buildContextResult([result], Number.MAX_SAFE_INTEGER)

    expect(buildContext([result], full.text.length)).toBe(full.text)
    const belowBoundary = buildContextResult([result], full.text.length - 1)
    expect(belowBoundary.text).not.toContain(result.chunk.content)
    expect(belowBoundary.text.length).toBeLessThanOrEqual(full.text.length - 1)
    expect(belowBoundary.skippedSources).toMatchObject([{ sourceNumber: 1, reason: 'budget_exceeded' }])
    expect(full.coverage).toEqual({ requested: 1, included: 1, skipped: 0 })
    expect(full.text).toContain('检索：hybrid，相关度 0.900')
  })

  it.each([
    ['代码围栏', '```ts\nconst value = 1\n```'],
    ['公式', '$$\na^2 + b^2 = c^2\n$$'],
    ['表格', '| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |'],
  ])('keeps a complete %s chunk atomic', (_, content) => {
    const result = createResult(1, content)
    const packed = buildContextResult([result], 6000)

    expect(packed.text).toContain(content)
    expect(packed.includedSources[0].result.chunk.content).toBe(content)
    expect(result.chunk.content).toBe(content)
  })

  it('skips an oversized candidate and still packs a later shorter candidate', () => {
    const oversized = createResult(1, 'x'.repeat(800))
    const shorter = createResult(2, '可装入的完整短块')
    const shorterOnly = buildContextResult([shorter], Number.MAX_SAFE_INTEGER).text
    const budget = shorterOnly.length + 80
    const packed = buildContextResult([oversized, shorter], budget)

    expect(packed.text.length).toBeLessThanOrEqual(budget)
    expect(packed.text).not.toContain(oversized.chunk.content)
    expect(packed.text).toContain(shorter.chunk.content)
    expect(packed.text).toContain('已跳过 1 个超出预算的来源：1')
    expect(packed.includedSources.map((source) => source.sourceNumber)).toEqual([2])
    expect(packed.skippedSources).toMatchObject([{ sourceNumber: 1, reason: 'budget_exceeded' }])
    expect(packed.coverage).toEqual({ requested: 2, included: 1, skipped: 1 })
  })

  it('keeps accepted source order and reports each skipped original source number', () => {
    const first = createResult(1, '第一个短块')
    const oversized = createResult(2, 'y'.repeat(800))
    const third = createResult(3, '第三个短块')
    const reference = buildContextResult([first, third], Number.MAX_SAFE_INTEGER).text
    const packed = buildContextResult([first, oversized, third], reference.length + 80)

    expect(packed.includedSources.map((source) => source.sourceNumber)).toEqual([1, 3])
    expect(packed.text.indexOf('[知识来源 1]')).toBeLessThan(packed.text.indexOf('[知识来源 3]'))
    expect(packed.skippedSources.map((source) => source.sourceNumber)).toEqual([2])
  })

  it('assigns continuous stable IDs only to sources included in the model context', () => {
    const first = createResult(1, '第一个短块')
    const oversized = createResult(2, 'y'.repeat(800))
    const third = createResult(3, '第三个短块')
    const reference = buildContextResult([first, third], Number.MAX_SAFE_INTEGER, { referenceIds: true }).text
    const packed = buildContextResult([first, oversized, third], reference.length + 80, { referenceIds: true })

    expect(packed.includedSources.map((source) => [source.sourceNumber, source.referenceId])).toEqual([
      [1, 'S1'],
      [3, 'S2'],
    ])
    expect(packed.text.indexOf('[S1]')).toBeLessThan(packed.text.indexOf('[S2]'))
    expect(packed.text).not.toContain('[知识来源')
    expect(packed.skippedSources.map((source) => source.sourceNumber)).toEqual([2])
  })

  it('returns stable empty coverage when even omission metadata does not fit', () => {
    const results = [createResult(1, 'a'.repeat(400)), createResult(2, 'b'.repeat(400))]
    const packed = buildContextResult(results, 20)

    expect(packed.text).toBe('')
    expect(packed.includedSources).toEqual([])
    expect(packed.skippedSources).toMatchObject([
      { sourceNumber: 1, reason: 'budget_exceeded' },
      { sourceNumber: 2, reason: 'budget_exceeded' },
    ])
    expect(packed.coverage).toEqual({ requested: 2, included: 0, skipped: 2 })
  })

  it('packs deduplicated same-heading neighbors only from remaining budget', () => {
    const result = createResult(1, '主证据')
    result.chunk.titlePath = ['同一章节']
    result.neighborChunks = [
      { ...result.chunk, id: 'neighbor-before', index: 0, content: '前置解释', contextRole: 'neighbor-context' },
      { ...result.chunk, id: 'neighbor-after', index: 2, content: '后续结论', contextRole: 'neighbor-context' },
      { ...result.chunk, id: result.chunk.id, content: '不得重复', contextRole: 'neighbor-context' },
    ]
    const full = buildContextResult([result], Number.MAX_SAFE_INTEGER)

    expect(full.text).toContain('[neighbor-context]')
    expect(full.text).toContain('前置解释')
    expect(full.text).toContain('后续结论')
    expect(full.text).not.toContain('不得重复')
    expect(full.includedSources).toHaveLength(1)

    const mainOnly = createResult(1, '主证据')
    mainOnly.chunk.titlePath = ['同一章节']
    const mainBudget = buildContextResult([mainOnly], Number.MAX_SAFE_INTEGER).text.length
    const constrained = buildContextResult([result], mainBudget)
    expect(constrained.text).toContain('主证据')
    expect(constrained.text).not.toContain('[neighbor-context]')
  })
})
