import type {
  AiConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatTool,
  ChatToolCall,
  StreamChunk,
  ValidateResult,
} from '../types'
import { AiAuthError, AiError, AiNetworkError } from '../errors'
import { parseOpenAIResponsesSSEStream } from '../stream'
import { ExternalHttpError, externalFetch, UnsupportedCapabilityError } from '../../externalHttp'
import { supportsReasoning } from '../reasoningAdapter'
import { OpenAICompatibleProvider } from './openaiCompatible'

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toResponsesInput(messages: ChatMessage[]): Array<Pick<ChatMessage, 'role' | 'content'>> {
  return messages.map(({ role, content }) => ({ role, content }))
}

function toResponsesTools(tools: ChatTool[]): JsonObject[] {
  return tools.map(({ function: definition }) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }))
}

function parseToolArguments(argumentsText: unknown): Record<string, unknown> {
  if (typeof argumentsText !== 'string' || !argumentsText) return {}
  try {
    const parsed = JSON.parse(argumentsText)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function extractResponseContent(data: JsonObject): string {
  const content: string[] = []
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue
      for (const part of item.content) {
        if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
          content.push(part.text)
        }
        if (isRecord(part) && part.type === 'refusal' && typeof part.refusal === 'string') {
          content.push(part.refusal)
        }
      }
    }
  }
  if (content.length > 0) return content.join('')
  return typeof data.output_text === 'string' ? data.output_text : ''
}

function extractResponseToolCalls(data: JsonObject): ChatToolCall[] | undefined {
  if (!Array.isArray(data.output)) return undefined

  const calls: ChatToolCall[] = []
  for (const item of data.output) {
    if (!isRecord(item) || item.type !== 'function_call' || typeof item.name !== 'string') continue
    calls.push({
      id: typeof item.call_id === 'string'
        ? item.call_id
        : typeof item.id === 'string'
          ? item.id
          : undefined,
      name: item.name,
      args: parseToolArguments(item.arguments),
    })
  }

  return calls.length > 0 ? calls : undefined
}

function extractResponseError(data: JsonObject): string {
  if (isRecord(data.error) && typeof data.error.message === 'string') return data.error.message
  if (typeof data.error === 'string') return data.error
  return 'Response failed'
}

function extractUsage(data: JsonObject): ChatResponse['usage'] {
  if (!isRecord(data.usage)) return undefined
  const numberOrZero = (value: unknown) => typeof value === 'number' ? value : 0
  return {
    promptTokens: numberOrZero(data.usage.input_tokens),
    completionTokens: numberOrZero(data.usage.output_tokens),
    totalTokens: numberOrZero(data.usage.total_tokens),
  }
}

export class OpenAIResponsesProvider extends OpenAICompatibleProvider {
  constructor(config: AiConfig) {
    super(config)
  }

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.chatModel,
      input: toResponsesInput(request.messages),
      stream,
      store: false,
      temperature: request.temperature ?? this.config.temperature,
      top_p: this.config.topP,
      max_output_tokens: request.maxTokens,
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = toResponsesTools(request.tools)
      body.tool_choice = request.toolChoice || 'auto'
    }

    if (
      request.reasoningMode === 'on'
      && supportsReasoning(this.config.provider, this.config.chatModel) === true
    ) {
      body.reasoning = { effort: 'medium' }
      delete body.temperature
    }

    return body
  }

  private async postResponses(
    body: Record<string, unknown>,
    signal: AbortSignal,
    retryWithoutReasoning: boolean,
  ): Promise<Response> {
    let response = await externalFetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal,
    })

    if (
      !response.ok
      && retryWithoutReasoning
      && (response.status === 400 || response.status === 422)
    ) {
      delete body.reasoning
      response = await externalFetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal,
      })
    }

    if (response.status === 401) throw new AiAuthError()
    if (!response.ok) {
      throw new AiError(await response.text(), 'API_ERROR', response.status)
    }
    return response
  }

  private throwRequestError(err: unknown, signal?: AbortSignal): never {
    if (err instanceof UnsupportedCapabilityError || err instanceof ExternalHttpError) throw err
    if (err instanceof AiError) throw err
    if ((err as Error).name === 'AbortError') {
      throw new AiNetworkError(signal?.aborted ? 'Request aborted' : 'Request timeout')
    }
    throw this.wrapNetworkError(err)
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false)
    const abort = this.createAbortContext(request.signal)
    const reasoningApplied = 'reasoning' in body

    try {
      const response = await this.postResponses(body, abort.signal, reasoningApplied)
      const data: unknown = await response.json()
      if (!isRecord(data)) throw new AiError('Invalid response', 'API_ERROR')
      if (data.status === 'failed') throw new AiError(extractResponseError(data), 'API_ERROR')

      return {
        id: typeof data.id === 'string' ? data.id : '',
        content: extractResponseContent(data),
        role: 'assistant',
        toolCalls: extractResponseToolCalls(data),
        usage: extractUsage(data),
      }
    } catch (err) {
      this.throwRequestError(err, request.signal)
    } finally {
      abort.cleanup()
    }
  }

  async *streamChat(request: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request, true)
    const abort = this.createAbortContext(request.signal)
    const reasoningApplied = 'reasoning' in body

    try {
      const response = await this.postResponses(body, abort.signal, reasoningApplied)
      abort.refreshTimeout()
      for await (const chunk of parseOpenAIResponsesSSEStream(response)) {
        abort.refreshTimeout()
        yield chunk
      }
    } catch (err) {
      this.throwRequestError(err, request.signal)
    } finally {
      abort.cleanup()
    }
  }

  async validateConfig(): Promise<ValidateResult> {
    try {
      const response = await externalFetch(`${this.baseUrl}/models`, { headers: this.headers })
      if (response.ok) {
        const data: unknown = await response.json()
        const models = isRecord(data) && Array.isArray(data.data)
          ? data.data
              .filter(isRecord)
              .map((model) => model.id)
              .filter((id): id is string => typeof id === 'string')
          : []
        return { ok: true, models }
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'auth_failed', message: 'API Key 无效或权限不足' }
      }
    } catch (err) {
      if (err instanceof UnsupportedCapabilityError || err instanceof ExternalHttpError) throw err
      if ((err as Error).name === 'AbortError') {
        return { ok: false, error: 'timeout', message: '连接超时，请检查网络或地址是否正确' }
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await externalFetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: this.config.chatModel,
          input: 'hi',
          max_output_tokens: 5,
          store: false,
        }),
        signal: controller.signal,
      })

      if (response.ok) return { ok: true }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'auth_failed', message: 'API Key 无效或权限不足' }
      }
      if (response.status === 404) {
        const body = await response.text()
        const hint = body ? `（${body.slice(0, 200)}）` : ''
        return { ok: false, error: 'not_found', message: `端点或模型不存在，请检查 Base URL 和模型名称${hint}` }
      }
      if (response.status === 400 || response.status === 422) {
        const body = await response.text()
        const hint = body ? `（${body.slice(0, 200)}）` : ''
        return { ok: false, error: 'bad_request', message: `请求参数被拒绝，可能是模型名称不支持${hint}` }
      }
      const body = await response.text()
      const hint = body ? `（${body.slice(0, 200)}）` : ''
      return { ok: false, error: 'unknown', message: `服务返回 HTTP ${response.status}${hint}` }
    } catch (err) {
      if (err instanceof UnsupportedCapabilityError || err instanceof ExternalHttpError) throw err
      if ((err as Error).name === 'AbortError') {
        return { ok: false, error: 'timeout', message: '连接超时，请检查网络或地址是否正确' }
      }
      const rawMsg = (err as Error).message || String(err)
      return { ok: false, error: 'network_error', message: `网络连接失败：${rawMsg}` }
    } finally {
      clearTimeout(timeout)
    }
  }
}
