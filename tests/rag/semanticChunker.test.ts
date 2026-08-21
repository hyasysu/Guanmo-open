import { describe, expect, it } from 'vitest'
import { buildSemanticDocumentChunks, estimateSemanticTokens } from '@/services/rag/semanticChunker'

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

  it('普通长文本只在安全语义边界按软阈值拆分', () => {
    const first = `系统先读取匿名任务状态并校验输入。${'处理记录保持匿名并逐项核对状态。'.repeat(18)}`
    const second = `因此，${'处理器按事务边界提交匿名结果。'.repeat(18)}`

    const chunks = buildSemanticDocumentChunks(`# 匿名记录\n\n${first}\n\n${second}`)

    expect(chunks).toHaveLength(2)
    expect(chunks[0].content).toBe(first)
    expect(chunks[1].content).toBe(second)
    expect(chunks.every((chunk) => estimateSemanticTokens(chunk.content) <= 400)).toBe(true)
    expect(chunks.every((chunk) => chunk.headingPath.join(' > ') === '匿名记录')).toBe(true)
  })

  it('无安全边界的超长普通文本保持完整并允许超过软阈值', () => {
    const source = '匿名连续文本'.repeat(120)

    const chunks = buildSemanticDocumentChunks(source)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe(source)
    expect(estimateSemanticTokens(chunks[0].content)).toBeGreaterThan(400)
  })

  it.each([
    ['列表', ['# 匿名记录', '', '- 第一项', '  - 子项', '- 第二项'].join('\n'), 'list'],
    ['表格', ['# 匿名记录', '', '| 字段 | 值 |', '| --- | --- |', '| 匿名 | 内容 |'].join('\n'), 'table'],
  ])('%s 保持为单个 Markdown 语义原子', (_label, source, type) => {
    const chunks = buildSemanticDocumentChunks(source)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      type,
      headingPath: ['匿名记录'],
      startLine: 3,
    })
    expect(chunks[0].content).toBe(source.split('\n').slice(2).join('\n'))
  })
})
