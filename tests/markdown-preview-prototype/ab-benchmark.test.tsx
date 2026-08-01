/**
 * 阶段2原型：A/B 基准驱动（基于项目 vitest 默认 include tests/** 下）
 *
 * 在 jsdom 下分别渲染：
 *   A = 整篇 ReactMarkdown（与当前生产路径等价）
 *   B = 单次解析模型 + 可视区块虚拟化挂载（原型路径）
 *
 * 测量：
 *   - 首次可渲染耗时（模型/解析 + React render + 首次 commit）
 *   - 初始挂载块数与 DOM 节点数
 *   - 滚动到 50%、95% 位置后的挂载数量（用于证明 B 不随全文线性增长）
 *
 * 用法：
 *   npx vitest run tests/markdown-preview-prototype/ab-benchmark.test.tsx
 * 或：
 *   npm run test:preview-ab
 */

import { describe, it, expect } from 'vitest'
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { createMarkdownPreviewModel } from '@/services/markdownPreviewModel'
import { PrototypeMarkdownPreview } from '@scripts/markdown-preview-prototype/PrototypeMarkdownPreview'
import { BENCHMARK_SIZES, generateAnonymousMarkdown } from '@scripts/markdown-preview-prototype/generateBenchmarkDoc'
import { SEMANTIC_SAMPLES } from '@scripts/markdown-preview-prototype/semanticSamples'

describe('stage-2 | semantic samples (model correctness)', () => {
  SEMANTIC_SAMPLES.forEach((sample) => {
    it(sample.name, () => {
      const model = createMarkdownPreviewModel(sample.markdown)
      const errs = sample.assertions(model)
      expect(errs).toEqual([])
    })
  })
})

function median(values: number[]): number {
  const arr = values.slice().sort((a, b) => a - b)
  if (arr.length === 0) return 0
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid]
}

function p95(values: number[]): number {
  const arr = values.slice().sort((a, b) => a - b)
  if (arr.length === 0) return 0
  const idx = Math.max(0, Math.ceil(arr.length * 0.95) - 1)
  return arr[idx]
}

interface RunResult {
  size: string
  chars: number
  firstMsMedian: number
  firstMsP95: number
  domNodesMedian: number
  mountedBlocksMedian: number
  totalBlocks: number
  afterScroll50MountedMedian: number
  afterScroll95MountedMedian: number
}

const REPEAT = 5

function countDomDescendants(root: HTMLElement): number {
  let n = 0
  const walk = (el: Element) => {
    n += 1
    for (let i = 0; i < el.children.length; i += 1) walk(el.children[i])
  }
  walk(root)
  return n
}

function runForSize(sizeKey: string, chars: number, virtualize: boolean): RunResult {
  const doc = generateAnonymousMarkdown(chars, 7)
  const firstMs: number[] = []
  const domNodes: number[] = []
  const mountedBlocks: number[] = []
  const scroll50: number[] = []
  const scroll95: number[] = []
  let totalBlocks = 0

  for (let i = 0; i < REPEAT; i += 1) {
    const t0 = performance.now()
    let captured: { domNodes: number; mountedBlockCount: number } | null = null
    const view = render(
      React.createElement(PrototypeMarkdownPreview, {
        content: doc.markdown,
        fontSize: 14,
        lineHeight: 1.65,
        overscanBlocks: 5,
        virtualize,
        onFirstMounted: (info) => {
          captured = info
        },
      }),
    )
    const t1 = performance.now()
    firstMs.push(t1 - t0)
    const stats = screen.getByTestId('prototype-stats') as HTMLDivElement
    totalBlocks = Number(stats.dataset.totalBlocks) || 0
    domNodes.push(captured?.domNodes ?? countDomDescendants(view.container))
      mountedBlocks.push(captured?.mountedBlockCount ?? (Number(stats.dataset.mountedCount) || 0))

    const container = screen.getByTestId('prototype-scroll-container') as HTMLDivElement
    const spacer = screen.getByTestId('prototype-spacer') as HTMLDivElement
    const h = Number(spacer.style.height.replace('px', '')) || 1
    if (virtualize) {
      act(() => {
        container.scrollTop = h * 0.5
        container.dispatchEvent(new Event('scroll'))
      })
      scroll50.push(Number((screen.getByTestId('prototype-stats') as HTMLDivElement).dataset.mountedCount) || 0)
      act(() => {
        container.scrollTop = h * 0.95
        container.dispatchEvent(new Event('scroll'))
      })
      scroll95.push(Number((screen.getByTestId('prototype-stats') as HTMLDivElement).dataset.mountedCount) || 0)
    } else {
      scroll50.push(totalBlocks)
      scroll95.push(totalBlocks)
    }
    view.unmount()
  }

  return {
    size: sizeKey,
    chars,
    firstMsMedian: +median(firstMs).toFixed(2),
    firstMsP95: +p95(firstMs).toFixed(2),
    domNodesMedian: Math.round(median(domNodes)),
    mountedBlocksMedian: Math.round(median(mountedBlocks)),
    totalBlocks,
    afterScroll50MountedMedian: Math.round(median(scroll50)),
    afterScroll95MountedMedian: Math.round(median(scroll95)),
  }
}

// 供最终汇总测试读取
const A: RunResult[] = []
const B: RunResult[] = []

describe('stage-2 | A/B benchmark (anonymous fixtures, vitest jsdom)', () => {
  BENCHMARK_SIZES.forEach(({ key, chars }) => {
    // JSDOM 下大文档整篇渲染非常慢；按字符规模动态放大超时：<500K 用默认 180s，500K=5 分钟，1M=10 分钟。
    const timeoutMs = chars >= 1_000_000 ? 600_000 : chars >= 500_000 ? 300_000 : 180_000
    it(
      `A (full ReactMarkdown): ${key}`,
      () => {
        const r = runForSize(key, chars, false)
        A.push(r)
        expect(r.totalBlocks).toBeGreaterThan(0)
        expect(r.firstMsMedian).toBeGreaterThan(0)
        expect(r.mountedBlocksMedian).toBe(r.totalBlocks)
      },
      timeoutMs,
    )
  })

  BENCHMARK_SIZES.forEach(({ key, chars }) => {
    const timeoutMs = chars >= 1_000_000 ? 600_000 : chars >= 500_000 ? 300_000 : 180_000
    it(
      `B (virtualized model): ${key}`,
      () => {
        const r = runForSize(key, chars, true)
        B.push(r)
        expect(r.totalBlocks).toBeGreaterThan(0)
        expect(r.firstMsMedian).toBeGreaterThan(0)
        if (chars >= 200_000) {
          expect(r.mountedBlocksMedian).toBeLessThan(r.totalBlocks * 0.4)
        }
        if (chars >= 500_000) {
          expect(r.afterScroll95MountedMedian).toBeLessThan(r.totalBlocks * 0.3)
        }
      },
      timeoutMs,
    )
  })

  it('prints A/B summary (read from stdout for stage-2 report)', () => {
    expect(A.length).toBe(BENCHMARK_SIZES.length)
    expect(B.length).toBe(BENCHMARK_SIZES.length)
    const header =
      'size,chars,A_median_ms,A_p95_ms,A_dom_nodes,A_blocks_total,B_median_ms,B_p95_ms,B_dom_nodes,B_mounted_blocks,B_50pct_mounted,B_95pct_mounted,speedup_median,B_dom_vs_A_dom_pct'
    const rows: string[] = [header]
    for (let i = 0; i < BENCHMARK_SIZES.length; i += 1) {
      const a = A[i]!
      const b = B[i]!
      const speedup = a.firstMsMedian / Math.max(1, b.firstMsMedian)
      const domPct = a.domNodesMedian === 0 ? 0 : (b.domNodesMedian / a.domNodesMedian) * 100
      rows.push(
        [
          a.size,
          a.chars,
          a.firstMsMedian,
          a.firstMsP95,
          a.domNodesMedian,
          a.totalBlocks,
          b.firstMsMedian,
          b.firstMsP95,
          b.domNodesMedian,
          b.mountedBlocksMedian,
          b.afterScroll50MountedMedian,
          b.afterScroll95MountedMedian,
          speedup.toFixed(2) + 'x',
          domPct.toFixed(1) + '%',
        ].join(','),
      )
    }
    // eslint-disable-next-line no-console
    console.log('\n[stage-2 preview-ab summary]\n' + rows.join('\n') + '\n')
  })
})
