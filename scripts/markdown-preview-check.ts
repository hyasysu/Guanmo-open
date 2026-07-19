import assert from 'node:assert/strict'
import { MarkdownPreviewWorkerSession, parseMarkdownPreviewInWorker } from '../src/services/markdownPreviewParser'
import { parseMarkdownPreview } from '../src/services/markdownPreviewParserCore'

const markdown = [
  '# 标题',
  '',
  '普通段落与 [安全链接](https://example.com)。',
  '',
  '- [ ] 任务一',
  '- [x] 任务二',
  '',
  '| 名称 | 值 |',
  '| --- | --- |',
  '| A | 1 |',
  '',
  '```ts',
  'const answer = 42',
  '```',
  '',
  String.raw`\[`,
  'x^2 + y_1',
  String.raw`\]`,
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '脚注引用[^note]。',
  '',
  '[^note]: 脚注正文',
  '',
  '<script>alert(1)</script>',
  '',
  '[危险链接](javascript:alert(1))',
].join('\n')

const result = await parseMarkdownPreview(markdown)
assert.ok(result.blocks.length >= 9, '应按顶层 AST 语义节点拆分')
assert.equal(result.blocks[0].startLine, 1)
assert.ok(result.blocks.some((block) => block.startLine === 12 && block.endLine >= 14), '代码块应保留原文行号')
assert.ok(result.blocks.some((block) => block.startLine === 16 && block.endLine >= 18), '公式应保留原文行号')

const serialized = JSON.stringify(result.blocks)
assert.match(serialized, /language-ts/)
assert.match(serialized, /hljs/)
assert.match(serialized, /katex-display/)
assert.match(serialized, /language-mermaid/)
assert.match(serialized, /dataFootnoteRef/)
assert.match(serialized, /<script>alert\(1\)<\/script>/)
assert.doesNotMatch(serialized, /javascript:alert/)

const edited = await parseMarkdownPreview(markdown.replace('普通段落与', '修改后的普通段落与'))
assert.notEqual(edited.blocks[1].key, result.blocks[1].key, '变更块必须生成新键')
assert.equal(edited.blocks[0].key, result.blocks[0].key, '前置未变块必须复用稳定键')
assert.equal(edited.blocks[2].key, result.blocks[2].key, '后置未变块必须复用稳定键')

const shifted = await parseMarkdownPreview(markdown.replace('普通段落与', '新增一行\n普通段落与'))
const originalCode = result.blocks.find((block) => block.startLine === 12)
const shiftedCode = shifted.blocks.find((block) => JSON.stringify(block.tree).includes('language-ts'))
assert.equal(shiftedCode?.key, originalCode?.key, '行号变化不得破坏内容稳定键')
assert.equal(shiftedCode?.startLine, 13, '块行号必须随原文变化')

await assert.rejects(
  parseMarkdownPreviewInWorker('# 无 Worker 环境'),
  /不支持 Web Worker/,
  'Worker 不可用时必须返回可处理的 Promise rejection',
)

interface FakeWorkerResponse {
  id: number
  result?: { blocks: [] }
  error?: string
}

class FakeWorker {
  static instance: FakeWorker
  onmessage: ((event: MessageEvent<FakeWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: Array<{ id: number; content: string }> = []

  constructor() {
    FakeWorker.instance = this
  }

  postMessage(message: { id: number; content: string }) {
    this.messages.push(message)
  }

  terminate() {}

  respond(index: number) {
    const message = this.messages[index]
    this.onmessage?.({ data: { id: message.id, result: { blocks: [] } } } as MessageEvent<FakeWorkerResponse>)
  }

  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

Object.assign(globalThis, { Worker: FakeWorker })

const rapidSession = new MarkdownPreviewWorkerSession()
const firstLargeDocument = 'first large document'.padEnd(50_001, 'x')
const secondLargeDocument = 'second large document'.padEnd(50_001, 'x')
const latestLargeDocument = 'latest large document'.padEnd(50_001, 'x')
const first = rapidSession.parse(firstLargeDocument)
const second = rapidSession.parse(secondLargeDocument)
const latest = rapidSession.parse(latestLargeDocument)
await assert.rejects(first, { name: 'AbortError' }, '活跃的陈旧请求必须立即取消')
await assert.rejects(second, { name: 'AbortError' }, '尚未发送的中间请求必须被合并')
assert.deepEqual(FakeWorker.instance.messages.map((message) => message.content), [firstLargeDocument])
FakeWorker.instance.respond(0)
assert.deepEqual(
  FakeWorker.instance.messages.map((message) => message.content),
  [firstLargeDocument, latestLargeDocument],
  '快速输入只允许保留正在执行与最后一次请求',
)
FakeWorker.instance.respond(1)
assert.deepEqual(await latest, { blocks: [] })

const leftPreview = new MarkdownPreviewWorkerSession()
const rightPreview = new MarkdownPreviewWorkerSession()
const leftDocument = 'left preview'.padEnd(50_001, 'x')
const rightDocument = 'right preview'.padEnd(50_001, 'x')
const left = leftPreview.parse(leftDocument)
const right = rightPreview.parse(rightDocument)
leftPreview.dispose()
await assert.rejects(left, { name: 'AbortError' }, '释放预览必须清理自身 pending Promise')
const rightMessageIndex = FakeWorker.instance.messages.findIndex((message) => message.content === rightDocument)
FakeWorker.instance.respond(rightMessageIndex)
assert.deepEqual(await right, { blocks: [] }, '一个预览取消不得误取消另一个预览实例')
rightPreview.dispose()

const switchedPreview = new MarkdownPreviewWorkerSession()
const oldTab = switchedPreview.parse('old tab'.padEnd(50_001, 'x'))
switchedPreview.cancel()
await assert.rejects(oldTab, { name: 'AbortError' }, '切换标签必须清理旧请求')
const currentTabDocument = 'current tab'.padEnd(50_001, 'x')
const currentTab = switchedPreview.parse(currentTabDocument)
const currentMessageIndex = FakeWorker.instance.messages.findIndex((message) => message.content === currentTabDocument)
FakeWorker.instance.respond(currentMessageIndex)
assert.deepEqual(await currentTab, { blocks: [] })
switchedPreview.dispose()

const failedLeftSession = new MarkdownPreviewWorkerSession()
const failedRightSession = new MarkdownPreviewWorkerSession()
const failedLeft = failedLeftSession.parse('failed left preview')
const failedRight = failedRightSession.parse('failed right preview')
FakeWorker.instance.fail('worker exploded')
await assert.rejects(failedLeft, /worker exploded/)
await assert.rejects(failedRight, /worker exploded/)
const recoveredSession = new MarkdownPreviewWorkerSession()
const recovered = recoveredSession.parse('recovered preview')
assert.equal(FakeWorker.instance.messages.length, 1, 'Worker 失败后必须创建干净的新实例')
FakeWorker.instance.respond(0)
assert.deepEqual(await recovered, { blocks: [] })
failedLeftSession.dispose()
failedRightSession.dispose()
recoveredSession.dispose()

console.log('Markdown 预览解析检查通过')
