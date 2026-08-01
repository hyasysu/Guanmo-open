import { describe, expect, it, vi } from 'vitest'
import { buildAgentFinalAnswerMessages } from '@/services/aiChatMessages'
import { makeRoutingDecision } from '@/services/agent/routingService'
import {
  buildAgentRunRequest,
  buildEditTargets,
  buildRoutingAppContext,
} from '@/services/agent/requestBuilder'
import { buildAgentResultPresentation } from '@/services/agent/sourceMetadata'
import type { ContextTag } from '@/types/contextTag'

const selectionTag: ContextTag = {
  id: 'selection-1',
  type: 'selection',
  title: '匿名选区',
  filePath: 'C:\\Temp\\anonymous.md',
  content: '匿名文本',
  preview: '匿名文本',
  selectionFrom: 10,
  selectionTo: 14,
}

describe('AI chat orchestration helpers', () => {
  it('builds routing context and stable edit targets from current tags', () => {
    expect(buildRoutingAppContext([selectionTag], true)).toEqual({
      hasRecentEdit: true,
      hasOpenFile: false,
      hasSelection: true,
      hasContextTags: true,
    })
    expect(buildEditTargets([selectionTag])).toEqual([{
      id: 'edit-target-1',
      type: 'selection',
      title: '匿名选区',
      filePath: 'C:\\Temp\\anonymous.md',
      selectionFrom: 10,
      selectionTo: 14,
    }])
  })

  it('builds one AgentRunRequest from the routing decision without re-routing', () => {
    const routingDecision = makeRoutingDecision(
      '翻译并替换原文',
      buildRoutingAppContext([selectionTag], false),
      { contextTagCount: 1 },
    )
    const onStep = vi.fn()
    const controller = new AbortController()
    const built = buildAgentRunRequest({
      content: '翻译并替换原文',
      messages: [],
      contextTags: [selectionTag],
      tagContext: '【当前上下文】匿名内容',
      memoryContext: '',
      routingDecision,
      hasRecentEditContext: false,
      hasPrefetchedMemoryLookup: false,
      signal: controller.signal,
      temperature: 0.2,
      onStep,
      streamEnabled: true,
    })

    expect(built.originalRequest).toBe('翻译并替换原文')
    expect(built.request.routingDecision).toBe(routingDecision)
    expect(built.request.candidateToolNames).toEqual(routingDecision.candidateTools)
    expect(built.request.currentEditTargetCount).toBe(1)
    expect(built.request.hasCurrentEditTarget).toBe(true)
    expect(built.request.untrustedContext).toContain('targetId: edit-target-1')
  })

  it('maps Agent result sources and final messages without changing user-visible text', () => {
    const result = {
      answer: '{"tool":"ignored"}\n最终回答',
      steps: [{
        type: 'observation' as const,
        content: JSON.stringify({
          results: [{
            filePath: 'C:\\Temp\\anonymous.md',
            title: '匿名文档',
            titlePath: ['章节'],
            heading: '章节',
            startLine: 3,
            endLine: 5,
          }],
        }),
        timestamp: 1,
      }],
      toolCalls: 1,
      reason: 'completed' as const,
    }
    const presentation = buildAgentResultPresentation(result, 1)

    expect(presentation.answer).toBe('最终回答')
    expect(presentation.contextMeta).toEqual({
      tagCount: 1,
      ragSourceCount: 1,
      webSearchUsed: false,
    })
    expect(presentation.sources[0]).toMatchObject({
      kind: 'local',
      fileName: 'anonymous.md',
      startLine: 3,
      endLine: 5,
    })

    expect(buildAgentFinalAnswerMessages([{ role: 'assistant', content: '工具结果' }])).toEqual([
      { role: 'assistant', content: '工具结果' },
      {
        role: 'user',
        content: '如果工具结果不足、记忆不确定、数据不存在或证据太弱，必须明确说不确定或当前信息不足，禁止脑补。',
      },
    ])
  })
})
