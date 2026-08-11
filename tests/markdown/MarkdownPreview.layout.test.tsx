import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

const MINIMAL_FRONT_MATTER_DOCUMENT = [
  '---',
  'ai_question: |-',
  '  联网搜索一下广东什么时候才会正式进入秋天',
  '---',
  '',
  '# AI 阅读回复',
  '',
  '> 生成于 2026-08-10',
  '',
  '---',
].join('\n')

class TestResizeObserver {
  static instances: TestResizeObserver[] = []

  readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

const OriginalResizeObserver = globalThis.ResizeObserver

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  }
}

function createPreviewHost(getWidth: () => number) {
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientHeight: { configurable: true, get: () => 800 },
    clientWidth: { configurable: true, get: getWidth },
    scrollTop: { configurable: true, value: 0, writable: true },
  })
  return host
}

beforeEach(() => {
  TestResizeObserver.instances = []
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.ResizeObserver = OriginalResizeObserver
})

describe('MarkdownPreview Front Matter 布局', () => {
  it('实测高度暂不可用时仍为 Front Matter 保留非零估算空间', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(600, 0))
    const host = createPreviewHost(() => 600)

    render(<MarkdownPreview content={MINIMAL_FRONT_MATTER_DOCUMENT} />, { container: host })

    const blocks = Array.from(host.querySelectorAll<HTMLElement>('[data-md-block-index]'))
    expect(blocks.map((block) => block.dataset.mdBlockType)).toEqual([
      'frontmatter',
      'heading',
      'blockquote',
      'thematicBreak',
    ])
    expect(blocks.map((block) => [block.dataset.mdLine, block.dataset.mdEndLine])).toEqual([
      ['1', '5'],
      ['6', '6'],
      ['8', '8'],
      ['10', '10'],
    ])
    expect(Number.parseFloat(blocks[1].style.top)).toBeGreaterThan(0)
  })

  it('宽度连续变化时在布局阶段重新测量已挂载块', () => {
    let viewportWidth = 600
    const heightReads = new Map<string, number>()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const blockType = this.dataset.mdBlockType
      if (!blockType) return rect(viewportWidth, 0)
      heightReads.set(blockType, (heightReads.get(blockType) ?? 0) + 1)
      const height = blockType === 'frontmatter'
        ? (viewportWidth >= 900 ? 96 : 128)
        : blockType === 'heading'
          ? 52
          : blockType === 'blockquote'
            ? 48
            : 32
      return rect(viewportWidth, height)
    })
    const host = createPreviewHost(() => viewportWidth)

    render(<MarkdownPreview content={MINIMAL_FRONT_MATTER_DOCUMENT} />, { container: host })

    const heading = host.querySelector<HTMLElement>('[data-md-block-type="heading"]')
    expect(heading?.style.top).toBe('128px')
    const readsAtInitialWidth = heightReads.get('frontmatter') ?? 0
    const containerObserver = TestResizeObserver.instances.find((observer) => observer.targets.has(host))
    expect(containerObserver).toBeDefined()

    viewportWidth = 1000
    containerObserver?.trigger()

    expect(heading?.style.top).toBe('96px')
    const readsAtFullWidth = heightReads.get('frontmatter') ?? 0
    expect(readsAtFullWidth).toBeGreaterThan(readsAtInitialWidth)

    viewportWidth = 520
    containerObserver?.trigger()

    expect(heading?.style.top).toBe('128px')
    expect(heightReads.get('frontmatter')).toBeGreaterThan(readsAtFullWidth)
  })
})
