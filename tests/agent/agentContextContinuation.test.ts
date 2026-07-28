import { describe, expect, it } from 'vitest'
import {
  createAgentTaskContext,
  resolveAgentContextContinuation,
} from '@/services/agent/session'
import { detectIntentScores } from '@/services/agent/intentDetector'
import { buildCandidateTools } from '@/services/agent/toolSelector'
import type { AgentTaskContext } from '@/services/agent/types'

function webSearchContext(overrides: Partial<AgentTaskContext> = {}): AgentTaskContext {
  return {
    intent: ['web'],
    requiredCapabilities: ['web'],
    candidateToolNames: ['web_search'],
    usedToolNames: ['web_search'],
    originalRequest: '搜索 React 19 新特性',
    status: 'success',
    resultSummary: '找到 React 19 相关资料',
    ...overrides,
  }
}

describe('Agent 短期任务上下文', () => {
  it('首次联网搜索仍按原规则路由到 web_search', () => {
    const intent = detectIntentScores('搜索 React 19 新特性')

    expect(intent.candidates).toContain('web')
    expect(buildCandidateTools(intent.candidates)).toContain('web_search')
  })

  it.each([
    '再试一次',
    '重试',
    '继续',
    '重新',
    '换一个',
    '换个方法',
    '刚才那个',
    '还是不行',
    '再找找',
  ])('短指令“%s”继承上一轮 intent 和工具', (query) => {
    const continuation = resolveAgentContextContinuation(query, webSearchContext())

    expect(continuation).toMatchObject({
      intent: ['web'],
      requiredCapabilities: ['web'],
      toolNames: ['web_search'],
      originalRequest: '搜索 React 19 新特性',
    })
    expect(continuation?.query).toContain('上一轮任务：搜索 React 19 新特性')
    expect(continuation?.query).toContain(`本轮要求：${query}`)
  })

  it('普通解释请求不会继承之前的联网工具', () => {
    expect(resolveAgentContextContinuation(
      '解释一下这段代码',
      webSearchContext(),
    )).toBeNull()
  })

  it('带有明确新任务的重新请求不会被当作短指令', () => {
    expect(resolveAgentContextContinuation(
      '重新解释 React 19 的并发特性',
      webSearchContext(),
    )).toBeNull()
  })

  it('记录实际使用工具、执行状态和结果摘要', () => {
    const context = createAgentTaskContext({
      originalRequest: '搜索 React 19 新特性',
      intent: ['web'],
      requiredCapabilities: ['web'],
      candidateToolNames: ['web_search'],
      result: {
        answer: '',
        reason: 'completed',
        toolCalls: 1,
        steps: [
          {
            type: 'action',
            content: '调用工具: web_search',
            toolName: 'web_search',
            timestamp: 1,
          },
          {
            type: 'observation',
            content: '找到 React 19 相关资料',
            toolName: 'web_search',
            timestamp: 2,
          },
        ],
      },
    })

    expect(context).toMatchObject({
      intent: ['web'],
      usedToolNames: ['web_search'],
      originalRequest: '搜索 React 19 新特性',
      status: 'success',
      resultSummary: '找到 React 19 相关资料',
    })
  })

  it('工具尚未实际调用时回退到上一轮候选工具重试', () => {
    const continuation = resolveAgentContextContinuation(
      '再试一次',
      webSearchContext({ usedToolNames: [], status: 'failed' }),
    )

    expect(continuation?.toolNames).toEqual(['web_search'])
  })

  it('工具返回失败结果时记录失败状态', () => {
    const context = createAgentTaskContext({
      originalRequest: '搜索 React 19 新特性',
      intent: ['web'],
      requiredCapabilities: ['web'],
      candidateToolNames: ['web_search'],
      result: {
        answer: '搜索失败',
        reason: 'completed',
        toolCalls: 1,
        steps: [{
          type: 'observation',
          content: '工具执行出错: 网络不可用',
          toolName: 'web_search',
          timestamp: 1,
        }],
      },
    })

    expect(context.status).toBe('failed')
    expect(context.resultSummary).toBe('工具执行出错: 网络不可用')
  })
})
