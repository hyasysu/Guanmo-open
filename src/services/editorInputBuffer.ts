export function getEditorContentFlushDelay(contentLength: number): number {
  if (contentLength >= 200_000) return 320
  if (contentLength >= 50_000) return 200
  return 100
}

export class DeferredContentEmitter<T> {
  private pending: T | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly serialize: (value: T) => string,
    private readonly emit: (content: string) => void
  ) {}

  get hasPending(): boolean {
    return this.pending !== null
  }

  push(value: T, contentLength: number): void {
    this.pending = value
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), getEditorContentFlushDelay(contentLength))
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending === null) return
    const pending = this.pending
    this.pending = null
    this.emit(this.serialize(pending))
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}
