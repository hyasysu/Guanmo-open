import type { MarkdownPreviewParseResult } from './markdownPreviewParserCore'

interface WorkerResponse {
  id: number
  result?: MarkdownPreviewParseResult
  error?: string
}

interface ParseRequest {
  content: string
  resolve: (result: MarkdownPreviewParseResult) => void
  reject: (error: Error) => void
  settled: boolean
}

interface ActiveRequest {
  id: number
  request: ParseRequest
}

interface PendingRequest {
  respond: (response: WorkerResponse) => void
  fail: (error: Error) => void
}

let sharedWorker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

export class MarkdownPreviewWorkerSession {
  private active: ActiveRequest | null = null
  private queued: ParseRequest | null = null
  private disposed = false

  parse(content: string): Promise<MarkdownPreviewParseResult> {
    if (this.disposed) {
      return Promise.reject(createCancellationError('Markdown 预览会话已释放'))
    }

    return new Promise((resolve, reject) => {
      const request: ParseRequest = { content, resolve, reject, settled: false }
      if (!this.active) {
        this.start(request)
        return
      }

      settleCancelled(this.active.request, 'Markdown 预览请求已被更新内容取代')
      if (this.queued) settleCancelled(this.queued, 'Markdown 预览请求已被更新内容取代')
      this.queued = request
    })
  }

  cancel(): void {
    if (this.active) {
      pendingRequests.delete(this.active.id)
      settleCancelled(this.active.request, 'Markdown 预览请求已取消')
      this.active = null
    }
    if (this.queued) {
      settleCancelled(this.queued, 'Markdown 预览请求已取消')
      this.queued = null
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
  }

  private start(request: ParseRequest): void {
    let worker: Worker
    try {
      worker = getSharedWorker()
    } catch (error) {
      settleRejected(request, toError(error))
      return
    }

    const id = nextRequestId++
    this.active = { id, request }
    pendingRequests.set(id, {
      respond: (response) => this.finish(id, response),
      fail: (error) => this.fail(id, error),
    })
    try {
      worker.postMessage({ id, content: request.content })
    } catch (error) {
      pendingRequests.delete(id)
      this.fail(id, toError(error))
    }
  }

  private finish(id: number, response: WorkerResponse): void {
    if (this.active?.id !== id) return
    const request = this.active.request
    this.active = null
    if (response.result) {
      settleResolved(request, response.result)
    } else {
      settleRejected(request, new Error(response.error || 'Markdown 预览解析失败'))
    }
    this.startQueued()
  }

  private fail(id: number, error: Error): void {
    if (this.active?.id !== id) return
    settleRejected(this.active.request, error)
    this.active = null
    if (this.queued) {
      settleRejected(this.queued, error)
      this.queued = null
    }
  }

  private startQueued(): void {
    if (this.disposed || !this.queued) return
    const queued = this.queued
    this.queued = null
    this.start(queued)
  }
}

export function parseMarkdownPreviewInWorker(content: string): Promise<MarkdownPreviewParseResult> {
  const session = new MarkdownPreviewWorkerSession()
  return session.parse(content).finally(() => session.dispose())
}

function getSharedWorker(): Worker {
  if (sharedWorker) return sharedWorker
  if (typeof Worker === 'undefined') {
    throw new Error('当前环境不支持 Web Worker')
  }

  const worker = new Worker(new URL('./markdownPreview.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const pending = pendingRequests.get(response.id)
    if (!pending) return
    pendingRequests.delete(response.id)
    pending.respond(response)
  }
  worker.onerror = (event) => {
    failWorker(new Error(event.message || 'Markdown 预览 Worker 运行失败'))
  }
  sharedWorker = worker
  return worker
}

function failWorker(error: Error): void {
  sharedWorker?.terminate()
  sharedWorker = null
  const pending = [...pendingRequests.values()]
  pendingRequests.clear()
  for (const request of pending) request.fail(error)
}

function settleResolved(request: ParseRequest, result: MarkdownPreviewParseResult): void {
  if (request.settled) return
  request.settled = true
  request.resolve(result)
}

function settleRejected(request: ParseRequest, error: Error): void {
  if (request.settled) return
  request.settled = true
  request.reject(error)
}

function settleCancelled(request: ParseRequest, message: string): void {
  settleRejected(request, createCancellationError(message))
}

function createCancellationError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
