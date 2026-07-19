import { describe, expect, it } from 'vitest'
import { buildSemanticDocumentChunks } from '@/services/rag/semanticChunker'

describe('Markdown 语义分块', () => {
  it('保留一个自然段内的完整句子，不按固定字符数切碎', () => {
    const paragraph = '第一句说明背景。第二句补充原因。第三句给出结论。'

    const chunks = buildSemanticDocumentChunks(paragraph)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe(paragraph)
  })

  it.each([
    ['代码块', 'typescript', 'const total = 1\n\n'.repeat(180)],
    ['Mermaid', 'mermaid', 'graph TD\nA-->B\n\n'.repeat(120)],
  ])('%s 即使超过普通预算也不会从围栏中间截断', (_label, language, body) => {
    const source = `\`\`\`${language}\n${body}\`\`\``

    const chunks = buildSemanticDocumentChunks(source)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('code')
    expect(chunks[0].content).toBe(source)
  })

  it('块级公式保持完整', () => {
    const formula = `$$\n${'x_1 + x_2 + x_3 = y\\\\\n\n'.repeat(120)}$$`

    const chunks = buildSemanticDocumentChunks(formula)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('math')
    expect(chunks[0].content).toBe(formula)
  })
})
