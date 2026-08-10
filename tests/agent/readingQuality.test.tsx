import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatBubble } from '@/components/ai/AiPanel'
import {
  createContextMeta,
  decodeReadingScope,
  decodeReadingSourceCoverage,
} from '@/services/aiChatMessages'
import {
  FILE_SUMMARY_ANSWER_PROMPT,
  LOCAL_RESEARCH_ANSWER_PROMPT,
  SECTION_READING_ANSWER_PROMPT,
} from '@/services/agent/answerInstructions'
import { makeRoutingDecision } from '@/services/agent/routingService'
import {
  buildScopedAgentResultPresentation,
  toContextTagSources,
} from '@/services/agent/sourceMetadata'
import type { AgentResult } from '@/services/agent/types'
import type { ContextTag } from '@/types/contextTag'

const selectionContext = { hasSelection: true, hasContextTags: true }
const fileContext = { hasOpenFile: true, hasContextTags: true }

function resultWithSteps(steps: AgentResult['steps'], sourceCount = 0): AgentResult {
  return {
    answer: '匿名回答',
    steps,
    sources: Array.from({ length: sourceCount }, (_, index) => ({
      kind: 'local' as const,
      filePath: `C:\\Temp\\anonymous-${index + 1}.md`,
      fileName: `anonymous-${index + 1}.md`,
      titlePath: ['匿名章节'],
      startLine: 2,
      endLine: 4,
    })),
    toolCalls: steps.length,
    reason: 'completed',
  }
}

describe('阅读范围路由', () => {
  it('选区解释保持直答且不读取未授权文件', () => {
    const decision = makeRoutingDecision('解释这段内容', selectionContext)
    expect(decision.mode).toBe('direct')
    expect(decision.readingScope).toBe('selection')
    expect(decision.candidateTools).toEqual([])
    expect(decision.answerInstruction).toBeUndefined()
  })

  it('章节总结只使用 heading/source offset 选区工具', () => {
    const decision = makeRoutingDecision('总结当前章节', selectionContext)
    expect(decision.mode).toBe('agent')
    expect(decision.readingScope).toBe('section')
    expect(decision.candidateTools).toContain('read_selection_context')
    expect(decision.candidateTools).not.toContain('read_context_file')
    expect(decision.candidateTools).not.toContain('search_knowledge')
    expect(decision.answerInstruction).toBe(SECTION_READING_ANSWER_PROMPT)
  })

  it('授权文件总结标记为全文范围并要求声明截断', () => {
    const decision = makeRoutingDecision('总结这个文件', fileContext)
    expect(decision.readingScope).toBe('document')
    expect(decision.candidateTools).toContain('read_context_file')
    expect(decision.answerInstruction).toBe(FILE_SUMMARY_ANSWER_PROMPT)
    expect(decision.answerInstruction).toContain('当前总结基于已读取范围')
  })

  it('多文档研究仅标记为工作区 TopK 检索', () => {
    const decision = makeRoutingDecision('研究一下知识库里互相冲突的方案', {})
    expect(decision.readingScope).toBe('workspace')
    expect(decision.candidateTools).toContain('search_knowledge')
    expect(decision.answerInstruction).toBe(LOCAL_RESEARCH_ANSWER_PROMPT)
    expect(decision.answerInstruction).toContain('冲突')
    expect(decision.answerInstruction).toContain('推断部分')
  })

  it('普通问答不误触发阅读范围或研究模板', () => {
    const decision = makeRoutingDecision('什么是闭包？', {})
    expect(decision.mode).toBe('direct')
    expect(decision.readingScope).toBeUndefined()
    expect(decision.answerInstruction).toBeUndefined()
  })
})

describe('来源覆盖元数据', () => {
  it('全文读取截断时记录 partial，不能冒充完整全文', () => {
    const result = resultWithSteps([{
      type: 'observation',
      toolName: 'read_context_file',
      content: JSON.stringify({ source: { truncated: true } }),
      timestamp: 1,
    }], 1)
    const presentation = buildScopedAgentResultPresentation(result, 1, 'document')
    expect(presentation.contextMeta.sourceCoverage).toBe('document_partial')
  })

  it('工作区弱相关或空结果明确记录无来源', () => {
    const result = resultWithSteps([{
      type: 'observation',
      toolName: 'search_knowledge',
      content: JSON.stringify({ status: 'empty', results: [] }),
      timestamp: 1,
    }])
    const presentation = buildScopedAgentResultPresentation(result, 0, 'workspace')
    expect(presentation.contextMeta.sourceCoverage).toBe('none')
    expect(presentation.sources).toEqual([])
  })

  it('选区来源只来自本轮带真实行号的授权标签', () => {
    const tags: ContextTag[] = [{
      id: 'selection-1',
      type: 'selection',
      title: '匿名选区',
      filePath: 'C:\\Temp\\anonymous.md',
      content: '匿名内容',
      preview: '匿名内容',
      startLine: 8,
      endLine: 10,
      selectionFrom: 30,
      selectionTo: 45,
    }]
    expect(toContextTagSources(tags)).toEqual([{
      kind: 'local',
      filePath: 'C:\\Temp\\anonymous.md',
      fileName: 'anonymous.md',
      startLine: 8,
      endLine: 10,
    }])
  })

  it('旧 metadata 可加载，未知新值安全降级', () => {
    expect(createContextMeta({ tagCount: 1, ragSourceCount: 0, webSearchUsed: false })).toEqual({
      tagCount: 1,
      ragSourceCount: 0,
      webSearchUsed: false,
    })
    expect(decodeReadingScope('future_scope')).toBeUndefined()
    expect(decodeReadingSourceCoverage({ value: 'workspace_topk' })).toBeUndefined()
  })
})

describe('阅读来源展示', () => {
  it('在 assistant 消息中复用来源打开入口', () => {
    const onOpenSource = vi.fn()
    render(<ChatBubble
      role="assistant"
      content="匿名回答"
      isLast={false}
      streaming={false}
      contextMeta={{
        tagCount: 1,
        ragSourceCount: 1,
        webSearchUsed: false,
        readingScope: 'section',
        sourceCoverage: 'section_chunks',
      }}
      sources={[{
        kind: 'local',
        filePath: 'C:\\Temp\\anonymous.md',
        fileName: 'anonymous.md',
        titlePath: ['匿名章节'],
        startLine: 2,
        endLine: 4,
      }]}
      onOpenSource={onOpenSource}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Sources 1' }))
    fireEvent.click(screen.getByRole('button', { name: /anonymous\.md/ }))
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\Temp\\anonymous.md',
      startLine: 2,
      endLine: 4,
    }))
  })
})
