import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

const BLOCK_HEIGHTS: Record<string, number> = {
  heading: 70,
  list: 200,
  table: 120,
  code: 280,
}

class ControlledResizeObserver implements ResizeObserver {
  static instances: ControlledResizeObserver[] = []

  readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    ControlledResizeObserver.instances.push(this)
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
    this.callback([], this)
  }
}

const CONTENT = [
  '## Info',
  '',
  '### Product',
  '- Item',
  '',
  '    10.0.0.1',
  '    10.0.0.2',
  '',
  '  More details',
  '',
  '### API',
  '| URL | KEY |',
  '| --- | --- |',
  '| https://example.com/v1 | redacted |',
  '',
  '```cmd',
  '@echo off',
  '',
  'echo done',
  '```',
].join('\n')

describe('MarkdownPreview layout measurement', () => {
  const originalResizeObserver = globalThis.ResizeObserver

  beforeEach(() => {
    ControlledResizeObserver.instances = []
    globalThis.ResizeObserver = ControlledResizeObserver
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const blockType = this.dataset.mdBlockType
      if (blockType) {
        const top = Number.parseFloat(this.style.top || '0')
        const height = BLOCK_HEIGHTS[blockType] ?? 40
        return DOMRect.fromRect({ x: 0, y: top, width: 800, height })
      }
      return DOMRect.fromRect()
    })
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('remeasures mounted blocks after the preview width changes', () => {
    let width = 828
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientHeight: { configurable: true, get: () => 800 },
      clientWidth: { configurable: true, get: () => width },
    })

    const { container } = render(<MarkdownPreview content={CONTENT} />, { container: host })
    const blocks = () => [...container.querySelectorAll<HTMLElement>('[data-md-block-index]')]
    const assertNoOverlap = () => {
      const currentBlocks = blocks()
      for (let index = 0; index + 1 < currentBlocks.length; index += 1) {
        const current = currentBlocks[index]
        const next = currentBlocks[index + 1]
        const currentBottom = Number.parseFloat(current.style.top) + BLOCK_HEIGHTS[current.dataset.mdBlockType ?? '']
        expect(Number.parseFloat(next.style.top)).toBeGreaterThanOrEqual(currentBottom)
      }
    }

    expect(blocks()).toHaveLength(6)
    assertNoOverlap()

    const containerObserver = ControlledResizeObserver.instances.find((observer) => observer.targets.has(host))
    expect(containerObserver).toBeDefined()

    act(() => {
      width = 650
      containerObserver?.trigger()
    })

    assertNoOverlap()
  })
})
