import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, ChatRequest, ChatResponse, StreamChunk } from '@/services/ai/types'

const responseQueue: StreamChunk[][] = []
const streamChat = vi.fn(async function* (_request: ChatRequest) {
  const chunks = responseQueue.shift()
  if (!chunks) throw new Error('缺少匿名模型响应')
  for (const chunk of chunks) yield chunk
})

const client: AiProvider = {
  chat: vi.fn(async (): Promise<ChatResponse> => ({
    id: 'anonymous',
    content: '',
    role: 'assistant',
  })),
  streamChat,
  embedding: vi.fn(async () => ({ embedding: [] })),
  batchEmbedding: vi.fn(async () => []),
  validateConfig: vi.fn(async () => ({ valid: true })),
  listModels: vi.fn(async () => []),
}

vi.mock('@/services/ai/aiClient', () => ({
  getAiClient: () => client,
  isAiReady: () => true,
}))

describe('Agent execution budget', () => {
  let runAgent: typeof import('@/services/agent/executor').runAgent
  let registerTool: typeof import('@/services/agent/toolRegistry').registerTool
  const executeAnonymousRead = vi.fn(async () => '匿名工具结果')
  const executeAnonymousList = vi.fn(async () => '匿名列表结果')

  beforeAll(async () => {
    const executor = await import('@/services/agent/executor')
    const registry = await import('@/services/agent/toolRegistry')
    executor.initAgent()
    registry.registerTool({
      name: 'get_current_time',
      description: '匿名只读工具',
      parameters: [],
      execute: executeAnonymousRead,
    })
    registry.registerTool({
      name: 'list_memories',
      description: '匿名列表工具',
      parameters: [],
      execute: executeAnonymousList,
    })
    runAgent = executor.runAgent
    registerTool = registry.registerTool
  })

  beforeEach(() => {
    responseQueue.length = 0
    streamChat.mockClear()
    executeAnonymousRead.mockClear()
    executeAnonymousList.mockClear()
  })

  it('直接复用工具后的模型答案，不再请求第三次最终综合', async () => {
    responseQueue.push(
      [{
        content: '',
        done: true,
        toolCallDeltas: [{ index: 0, name: 'get_current_time', arguments: '{}' }],
      }],
      [
        { content: '匿名', done: false },
        { content: '最终答案', done: true },
      ],
    )
    const onStreamContent = vi.fn()

    const result = await runAgent({
      query: '匿名时间请求',
      candidateToolNames: ['get_current_time'],
      requiredCapabilities: ['time'],
      streamEnabled: true,
      onStreamContent,
    })

    expect(streamChat).toHaveBeenCalledTimes(2)
    expect(executeAnonymousRead).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      answer: '匿名最终答案',
      toolCalls: 1,
      reason: 'completed',
    })
    expect(result.finalMessages).toBeUndefined()
    expect(onStreamContent).toHaveBeenNthCalledWith(1, '匿名')
    expect(onStreamContent).toHaveBeenNthCalledWith(2, '匿名最终答案')
  })

  it('为同批次的每个工具分别发送执行阶段事件', async () => {
    responseQueue.push(
      [{
        content: '',
        done: true,
        toolCallDeltas: [
          { index: 0, name: 'get_current_time', arguments: '{}' },
          { index: 1, name: 'list_memories', arguments: '{}' },
        ],
      }],
      [{ content: '匿名多工具答案', done: true }],
    )
    const onStep = vi.fn()

    const result = await runAgent({
      query: '匿名多工具请求',
      candidateToolNames: ['get_current_time', 'list_memories'],
      streamEnabled: true,
      onStep,
    })

    expect(executeAnonymousRead).toHaveBeenCalledTimes(1)
    expect(executeAnonymousList).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toBe(2)
    expect(onStep.mock.calls
      .map(([step]) => step)
      .filter((step) => step.type === 'action')
      .map((step) => step.toolName)).toEqual(['get_current_time', 'list_memories'])
  })

  it('同轮相同只读工具与参数只执行一次', async () => {
    responseQueue.push(
      [{
        content: '',
        done: true,
        toolCallDeltas: [
          { index: 0, name: 'get_current_time', arguments: '{}' },
          { index: 1, name: 'get_current_time', arguments: '{}' },
        ],
      }],
      [{ content: '匿名去重答案', done: true }],
    )

    const result = await runAgent({
      query: '匿名重复调用请求',
      candidateToolNames: ['get_current_time'],
      streamEnabled: true,
    })

    expect(executeAnonymousRead).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toBe(1)
    expect(result.steps.filter((step) => step.type === 'observation')).toHaveLength(2)
  })

  it('达到工具调用预算后返回可综合的稳定终态', async () => {
    responseQueue.push([{
      content: '',
      done: true,
      toolCallDeltas: [{ index: 0, name: 'get_current_time', arguments: '{}' }],
    }])

    const result = await runAgent({
      query: '匿名预算请求',
      candidateToolNames: ['get_current_time'],
      config: { maxToolCalls: 1 },
      streamEnabled: true,
    })

    expect(streamChat).toHaveBeenCalledTimes(1)
    expect(result.reason).toBe('max_tool_calls')
    expect(result.toolCalls).toBe(1)
    expect(result.finalMessages?.at(-1)?.content).toContain('工具调用上限')
  })

  it('工具预算不会拦截必须生成的修改确认卡片', async () => {
    const executePendingEdit = vi.fn(async () => JSON.stringify({
      __pendingEdit: true,
      oldText: '匿名原文',
      newText: '匿名新文',
    }))
    registerTool({
      name: 'replace_current_tab_text',
      description: '匿名修改确认工具',
      parameters: [],
      execute: executePendingEdit,
    })
    responseQueue.push([{
      content: '',
      done: true,
      toolCallDeltas: [{ index: 0, name: 'replace_current_tab_text', arguments: '{}' }],
    }])

    const result = await runAgent({
      query: '修改匿名选区',
      currentEditTargetCount: 1,
      hasCurrentEditTarget: true,
      config: { maxToolCalls: 0 },
      routingDecision: {
        mode: 'agent',
        reasonCodes: ['strong_signal'],
        candidates: ['file_write'],
        required: [],
        candidateTools: ['replace_current_tab_text'],
        selectionRequestKind: 'none',
        requiresEditConfirmation: true,
        shouldLookupMemory: false,
        memoryIntent: 'none',
        shouldLookupKnowledge: false,
        isDocumentRewrite: true,
        isWebComparison: false,
        isLocalResearch: false,
        isFileSummary: false,
        explicitMemoryWriteIntent: false,
      },
      streamEnabled: true,
    })

    expect(executePendingEdit).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      answer: '',
      reason: 'completed',
      toolCalls: 1,
    })
  })

  it('请求在开始前取消时不调用模型或工具', async () => {
    const controller = new AbortController()
    controller.abort('anonymous_cancel')

    const result = await runAgent({
      query: '匿名取消请求',
      candidateToolNames: ['get_current_time'],
      signal: controller.signal,
      streamEnabled: true,
    })

    expect(streamChat).not.toHaveBeenCalled()
    expect(executeAnonymousRead).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      answer: '已取消本次 Agent 请求。',
      reason: 'error',
    })
  })

  it('工具超时后仍形成明确工具结果并稳定结束', async () => {
    registerTool({
      name: 'get_current_time',
      description: '匿名超时工具',
      parameters: [],
      execute: async () => await new Promise<string>(() => undefined),
    })
    responseQueue.push(
      [{
        content: '',
        done: true,
        toolCallDeltas: [{ index: 0, name: 'get_current_time', arguments: '{}' }],
      }],
      [{ content: '匿名超时降级答案', done: true }],
    )

    const result = await runAgent({
      query: '匿名超时请求',
      candidateToolNames: ['get_current_time'],
      config: { stepTimeout: 5 },
      streamEnabled: true,
    })

    expect(result.reason).toBe('completed')
    expect(result.answer).toBe('匿名超时降级答案')
    expect(result.steps.some((step) => step.content.includes('工具执行超时'))).toBe(true)

    registerTool({
      name: 'get_current_time',
      description: '匿名只读工具',
      parameters: [],
      execute: executeAnonymousRead,
    })
  })
})
