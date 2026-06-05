import type { StreamChunk } from './types'

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
      const done = Boolean(choice?.finish_reason)
      return { content, done }
    } catch {
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
        if (chunk.content) yield { content: chunk.content, done: false }
        if (chunk.done) {
          if (!chunk.content) yield { content: '', done: true }
          return
        }
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
              if (chunk.content) yield { content: chunk.content, done: false }
              if (chunk.done) {
                if (!chunk.content) yield { content: '', done: true }
                return
              }
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
      if (tail?.content) yield { content: tail.content, done: false }
      if (tail?.done) return
    }
  } finally {
    reader.releaseLock()
  }

  yield { content: '', done: true }
}
