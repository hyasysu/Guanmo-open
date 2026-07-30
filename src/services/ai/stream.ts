import type { StreamChunk } from './types'
import { AiError } from './errors'

type JsonObject = Record<string, unknown>

interface ResponsesSSEState {
  functionCalls: Map<number, { id?: string; name?: string; nameEmitted: boolean; receivedArgumentDelta: boolean }>
  itemIndexes: Map<string, number>
  nextSyntheticIndex: number
  textDeltaKeys: Set<string>
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSSEEvent(eventText: string): { eventType?: string; data: string } {
  let eventType: string | undefined
  const data: string[] = []

  for (const line of eventText.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      const value = line.slice(5)
      data.push(value.startsWith(' ') ? value.slice(1) : value)
    }
  }

  return { eventType, data: data.join('\n') }
}

function outputIndex(
  payload: JsonObject,
  state: ResponsesSSEState,
  itemId?: string,
): number {
  if (typeof payload.output_index === 'number') {
    if (itemId) state.itemIndexes.set(itemId, payload.output_index)
    return payload.output_index
  }
  if (itemId) {
    const existing = state.itemIndexes.get(itemId)
    if (existing !== undefined) return existing
  }
  const index = state.nextSyntheticIndex++
  if (itemId) state.itemIndexes.set(itemId, index)
  return index
}

function textKey(payload: JsonObject): string {
  const output = typeof payload.output_index === 'number' ? payload.output_index : -1
  const content = typeof payload.content_index === 'number' ? payload.content_index : -1
  return `${output}:${content}`
}

function responseStreamError(payload: JsonObject): AiError {
  const response = isRecord(payload.response) ? payload.response : undefined
  const nestedError = response && isRecord(response.error)
    ? response.error
    : isRecord(payload.error)
      ? payload.error
      : undefined
  const message = typeof nestedError?.message === 'string'
    ? nestedError.message
    : typeof payload.message === 'string'
      ? payload.message
      : 'Responses API stream failed'
  return new AiError(message, 'API_ERROR')
}

function parseResponsesSSEEvent(eventText: string, state: ResponsesSSEState): StreamChunk | null {
  const { eventType, data } = readSSEEvent(eventText)
  if (!data) return null
  if (data === '[DONE]') return { content: '', done: true }

  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch (err) {
    console.warn('[AI Stream] Invalid Responses SSE event', err)
    return null
  }
  if (!isRecord(payload)) return null

  const type = typeof payload.type === 'string' ? payload.type : eventType
  if (type === 'error' || type === 'response.failed') throw responseStreamError(payload)
  if (type === 'response.completed' || type === 'response.incomplete') return { content: '', done: true }

  if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
    if (typeof payload.delta !== 'string') return null
    state.textDeltaKeys.add(textKey(payload))
    return { content: payload.delta, done: false }
  }

  if (type === 'response.output_text.done' || type === 'response.refusal.done') {
    const key = textKey(payload)
    const text = type === 'response.output_text.done' ? payload.text : payload.refusal
    if (state.textDeltaKeys.has(key) || typeof text !== 'string') return null
    return { content: text, done: false }
  }

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    if (!isRecord(payload.item) || payload.item.type !== 'function_call') return null
    const item = payload.item
    const itemId = typeof item.id === 'string' ? item.id : undefined
    const index = outputIndex(payload, state, itemId)
    const existing = state.functionCalls.get(index) ?? {
      id: typeof item.call_id === 'string' ? item.call_id : itemId,
      name: typeof item.name === 'string' ? item.name : undefined,
      nameEmitted: false,
      receivedArgumentDelta: false,
    }
    if (!existing.id && typeof item.call_id === 'string') existing.id = item.call_id
    if (!existing.name && typeof item.name === 'string') existing.name = item.name
    state.functionCalls.set(index, existing)

    const delta: NonNullable<StreamChunk['toolCallDeltas']>[number] = { index }
    if (existing.id) delta.id = existing.id
    if (!existing.nameEmitted && existing.name) {
      delta.name = existing.name
      existing.nameEmitted = true
    }
    if (
      type === 'response.output_item.done'
      && !existing.receivedArgumentDelta
      && typeof item.arguments === 'string'
    ) {
      delta.arguments = item.arguments
      existing.receivedArgumentDelta = true
    }
    return delta.id || delta.name || delta.arguments
      ? { content: '', done: false, toolCallDeltas: [delta] }
      : null
  }

  if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
    const itemId = typeof payload.item_id === 'string' ? payload.item_id : undefined
    const index = outputIndex(payload, state, itemId)
    const existing = state.functionCalls.get(index) ?? {
      nameEmitted: false,
      receivedArgumentDelta: false,
    }
    state.functionCalls.set(index, existing)

    const argumentsText = type === 'response.function_call_arguments.delta'
      ? payload.delta
      : payload.arguments
    if (typeof argumentsText !== 'string') return null
    if (type === 'response.function_call_arguments.done' && existing.receivedArgumentDelta) return null

    existing.receivedArgumentDelta = true
    const delta: NonNullable<StreamChunk['toolCallDeltas']>[number] = { index, arguments: argumentsText }
    if (existing.id) delta.id = existing.id
    if (!existing.nameEmitted && existing.name) {
      delta.name = existing.name
      existing.nameEmitted = true
    }
    return { content: '', done: false, toolCallDeltas: [delta] }
  }

  return null
}

export async function* parseOpenAIResponsesSSEStream(
  response: Response,
): AsyncIterable<StreamChunk> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  const state: ResponsesSSEState = {
    functionCalls: new Map(),
    itemIndexes: new Map(),
    nextSyntheticIndex: 0,
    textDeltaKeys: new Set(),
  }
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split(/\r?\n\r?\n|\n\n|\r\r/)
      buffer = events.pop() || ''
      for (const event of events) {
        if (!event.trim()) continue
        const chunk = parseResponsesSSEEvent(event, state)
        if (!chunk) continue
        if (chunk.content || chunk.toolCallDeltas?.length || chunk.done) yield chunk
        if (chunk.done) return
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const chunk = parseResponsesSSEEvent(buffer, state)
      if (chunk && (chunk.content || chunk.toolCallDeltas?.length || chunk.done)) yield chunk
      if (chunk?.done) return
    }
  } finally {
    reader.releaseLock()
  }

  yield { content: '', done: true }
}

export async function* parseSSEStream(
  response: Response
): AsyncIterable<StreamChunk> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  const parseEvent = (eventText: string): StreamChunk | null => {
    const data = eventText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')

    if (!data) return null
    if (data === '[DONE]') return { content: '', done: true }

    try {
      const parsed = JSON.parse(data)
      const choice = parsed.choices?.[0]
      const content = choice?.delta?.content ?? choice?.message?.content ?? ''
      const toolCallDeltas = Array.isArray(choice?.delta?.tool_calls)
        ? choice.delta.tool_calls
            .filter((call: { index?: unknown }) => typeof call.index === 'number')
            .map((call: { index: number; id?: string; function?: { name?: string; arguments?: string } }) => ({
              index: call.index,
              id: call.id,
              name: call.function?.name,
              arguments: call.function?.arguments,
            }))
        : undefined
      const done = Boolean(choice?.finish_reason)
      return { content, done, toolCallDeltas }
    } catch (err) {
      console.warn(`[AI Stream] 忽略无法解析的 SSE 事件（${data.length} 字符）`, err)
      return null
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 改进：支持多种分隔符格式
      const events = buffer.split(/\r?\n\r?\n|\n\n|\r\r/)
      buffer = events.pop() || ''

      for (const event of events) {
        if (!event.trim()) continue
        const chunk = parseEvent(event)
        if (!chunk) continue
        if (chunk.content || chunk.toolCallDeltas?.length || chunk.done) yield chunk
        if (chunk.done) return
      }

      // 改进：处理单行事件（没有空行分隔的情况）
      const lines = buffer.split(/\r?\n/)
      const completeEvents: string[] = []
      let i = 0
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          // 空行表示事件结束
          if (completeEvents.length > 0) {
            const eventText = completeEvents.join('\n')
            const chunk = parseEvent(eventText)
            if (chunk) {
              if (chunk.content || chunk.toolCallDeltas?.length || chunk.done) yield chunk
              if (chunk.done) return
            }
            completeEvents.length = 0
          }
        } else {
          completeEvents.push(lines[i])
        }
        i++
      }
      buffer = completeEvents.join('\n')
    }

    // 处理剩余的缓冲区内容
    buffer += decoder.decode()
    if (buffer.trim()) {
      const tail = parseEvent(buffer)
      if (tail && (tail.content || tail.toolCallDeltas?.length || tail.done)) yield tail
      if (tail?.done) return
    }
  } finally {
    reader.releaseLock()
  }

  yield { content: '', done: true }
}
