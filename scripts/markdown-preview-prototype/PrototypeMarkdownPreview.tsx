/**
 * 阶段2原型：可视区块渲染 React 组件（隔离原型，不接入生产入口）
 *
 * 该组件只负责：
 * 1. 使用 MarkdownPreviewModel 单次解析全文
 * 2. 根据滚动容器当前可视区，计算需要挂载的块范围 [startIndex, endIndex)
 * 3. 未挂载块使用高度估计（estimateBlockHeight）作为占位，已挂载块写入真实测量值
 * 4. 块内部仍然交给 ReactMarkdown 解析和渲染，但只传入块的 normalized 切片
 * 5. 通过 data-md-block-index / data-md-line / data-md-block-id 暴露定位信息，
 *    供目录跳转、滚动同步、搜索高亮、预览内编辑、任务列表点击等上层交互使用
 *
 * 本文件为原型验证代码，不覆盖 IME/草稿/冲突检测/图片放大/预览内 overlay 编辑器等生产细节。
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, createContext, useContext } from 'react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  computeVisibleRange,
  createMarkdownPreviewModel,
  findBlockIndexByLine,
  searchContent,
  type MarkdownPreviewModel,
  type PreviewBlock,
  type SearchHit,
} from '@/services/markdownPreviewModel'
import { createHeadingId, type TocItem } from '@/services/markdownToc'

export interface PrototypePreviewProps {
  content: string
  fontSize?: number
  lineHeight?: number
  overscanBlocks?: number
  /** 用于 A/B 基准：true = 虚拟化路径 B；false = 整篇同步路径 A */
  virtualize?: boolean
  /** 挂载完成回调，用于测量首屏耗时 */
  onFirstMounted?: (info: { domNodes: number; mountedBlockCount: number }) => void
  onHeadingClick?: (line: number) => void
  onTaskToggle?: (line: number, checked: boolean) => void
}

interface ScrollState {
  scrollTop: number
  viewportHeight: number
}

const REMARK: NonNullable<Options['remarkPlugins']> = [remarkGfm, remarkMath]

/**
 * 单块渲染基址行号（块内解析器把 slice 第 1 行标为 line=1，需要加上块真实起始行 - 1 得到绝对行号。
 * 未进入块包裹时 base=0，此时内部绝对行号 == 本地行号（仅当整篇渲染时成立；整篇 A 路径只在对比性能时用）。
 */
const BlockLineBaseContext = createContext<number>(0)
function useBlockLineBase(): number {
  return useContext(BlockLineBaseContext)
}

export const PrototypeMarkdownPreview = memo(function PrototypeMarkdownPreview({
  content,
  fontSize = 14,
  lineHeight = 1.65,
  overscanBlocks = 5,
  virtualize = true,
  onFirstMounted,
  onHeadingClick,
  onTaskToggle,
}: PrototypePreviewProps) {
  const model = useMemo(() => createMarkdownPreviewModel(content), [content])
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const mountedFirstRef = useRef(false)
  const measuredHeightsRef = useRef<Map<string, number>>(new Map())
  const blockRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const [scrollState, setScrollState] = useState<ScrollState>({ scrollTop: 0, viewportHeight: 800 })

  // 当 content 变化时重置测量缓存与首次挂载标志
  useEffect(() => {
    measuredHeightsRef.current = new Map()
    mountedFirstRef.current = false
  }, [content])

  // 容器尺寸与滚动监听
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const update = () => setScrollState({ scrollTop: el.scrollTop, viewportHeight: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])

  // 高度估计策略（与 computeVisibleRange 保持一致）
  const estimateBlockHeight = useCallback(
    (block: PreviewBlock): number => {
      const baseLinePx = fontSize * lineHeight
      switch (block.type) {
        case 'frontmatter':
          return 0 // 原型不渲染 frontmatter；真实渲染可给固定高度
        case 'thematicBreak':
          return 32
        case 'heading': {
          const level = block.heading?.level ?? 2
          const mul = level === 1 ? 2 : level === 2 ? 1.6 : level === 3 ? 1.35 : 1.2
          return Math.ceil(baseLinePx * mul * 1.4)
        }
        case 'code':
        case 'mermaid': {
          const lines = block.codeMeta?.lines ?? Math.max(1, block.endLine - block.startLine + 1)
          return Math.max(40, lines * fontSize * 1.25 + 36)
        }
        case 'table': {
          const rows = block.tableMeta?.rows ?? Math.max(1, block.endLine - block.startLine + 1)
          const cols = block.tableMeta?.cols ?? 1
          return Math.max(48, rows * (baseLinePx + 8) + 32 + (cols > 4 ? 16 : 0))
        }
        case 'list': {
          const items = block.listItemCount ?? Math.max(1, Math.ceil((block.endLine - block.startLine + 1) / 2))
          return Math.max(24, items * baseLinePx * 1.2)
        }
        case 'image':
          return 220
        case 'math':
          return Math.max(48, (block.endLine - block.startLine + 1) * baseLinePx * 1.3 + 24)
        case 'html':
          return Math.max(32, (block.endLine - block.startLine + 1) * baseLinePx * 1.5)
        case 'definition':
        case 'footnoteDefinition':
          return Math.max(24, (block.endLine - block.startLine + 1) * baseLinePx * 1.1 + 8)
        case 'blockquote':
        case 'paragraph':
        case 'unknown':
        default:
          return Math.max(20, (block.endLine - block.startLine + 1) * baseLinePx * 1.15 + 12)
      }
    },
    [fontSize, lineHeight],
  )

  const visible = useMemo(() => {
    if (!virtualize) {
      // 路径 A：整篇挂载（与当前生产等价，但仍通过 model.blocks 保留 offset 语义）
      const totalH = model.blocks.reduce(
        (acc, b) => acc + (measuredHeightsRef.current.get(b.blockId) ?? estimateBlockHeight(b)),
        0,
      )
      const tops: number[] = []
      let c = 0
      for (let i = 0; i < model.blocks.length; i += 1) {
        tops.push(c)
        c += measuredHeightsRef.current.get(model.blocks[i].blockId) ?? estimateBlockHeight(model.blocks[i])
      }
      return { startIndex: 0, endIndex: model.blocks.length, blockTops: tops, totalHeight: totalH }
    }
    return computeVisibleRange(
      model,
      scrollState.scrollTop,
      scrollState.scrollTop + scrollState.viewportHeight,
      measuredHeightsRef.current,
      estimateBlockHeight,
      overscanBlocks,
    )
  }, [model, virtualize, scrollState, estimateBlockHeight, overscanBlocks])

  // 测量已挂载块的真实高度
  useLayoutEffect(() => {
    let changed = false
    for (let i = visible.startIndex; i < visible.endIndex; i += 1) {
      const el = blockRefs.current.get(i)
      const blk = model.blocks[i]
      if (!el || !blk) continue
      const h = el.getBoundingClientRect().height
      if (h > 0 && measuredHeightsRef.current.get(blk.blockId) !== h) {
        measuredHeightsRef.current.set(blk.blockId, h)
        changed = true
      }
    }
    if (changed) {
      // 触发一次重新计算 visible 范围（使用新高度）；不依赖 state 避免循环
      setScrollState((s) => ({ ...s }))
    }
  })

  // 首次挂载完成通知（A/B 基准依赖）
  useLayoutEffect(() => {
    if (mountedFirstRef.current) return
    if (visible.startIndex === 0 && visible.endIndex >= Math.min(1, model.blocks.length)) {
      mountedFirstRef.current = true
      const root = scrollContainerRef.current
      const domNodes = root ? countDescendantNodes(root) : 0
      onFirstMounted?.({ domNodes, mountedBlockCount: visible.endIndex - visible.startIndex })
    }
  })

  // commonComponents 不能直接用 hook，但是我们在块渲染层用 Context 注入 baseLine。
  // 所以我们把 commonComponents 拆成工厂，每次读取 base。
  const buildBlockComponents = useCallback(
    (baseLine: number): Partial<Components> => {
      const headingIds = new Map<string, number>()
      return {
        h1: ({ children, node }) => {
          const line = getNodeStartLine(node, baseLine)
          const text = getText(children)
          const id = line ? `heading-${line}` : createHeadingId(text, headingIds)
          return (
            <h1
              id={id}
              data-heading-id={id}
              data-md-line={line}
              onClick={() => line !== undefined && onHeadingClick?.(line)}
              className="scroll-mt-6 font-bold mt-8 mb-4 border-b pb-3"
              style={{ fontSize: '2em' }}
            >
              {children}
            </h1>
          )
        },
        h2: buildHeading(2, 1.5, headingIds, baseLine, onHeadingClick),
        h3: buildHeading(3, 1.25, headingIds, baseLine, onHeadingClick),
        h4: buildHeading(4, 1.1, headingIds, baseLine, onHeadingClick),
        input: ({ checked, ...props }) => {
          if (props.type !== 'checkbox') return <input {...props} />
          const isChecked = Boolean(checked)
          return (
            <input
              type="checkbox"
              checked={isChecked}
              readOnly={!onTaskToggle}
              disabled={!onTaskToggle}
              onChange={(e) => {
                e.stopPropagation()
                if (!onTaskToggle) return
                const target = e.currentTarget.closest<HTMLElement>('[data-md-line]')
                const lineStr = target?.dataset.mdLine
                const line = lineStr ? Number(lineStr) : undefined
                if (typeof line === 'number' && !Number.isNaN(line)) {
                  onTaskToggle(line, !isChecked)
                }
              }}
              style={{ cursor: onTaskToggle ? 'pointer' : undefined }}
            />
          )
        },
        li: ({ children, node, ...liProps }) => {
          const line = getNodeStartLine(node, baseLine)
          return (
            <li data-md-line={line} {...liProps}>
              {children}
            </li>
          )
        },
        p: ({ children, node, ...props }) => (
          <p
            {...props}
            className="my-3"
            data-md-line={getNodeStartLine(node, baseLine)}
            data-md-end-line={getNodeEndLine(node, baseLine)}
          >
            {children}
          </p>
        ),
      }
    },
    [onHeadingClick, onTaskToggle],
  )
  // virtualize=false 时整篇一次性挂载：baseLine 为 0（此时整篇 ReactMarkdown 的 position 是绝对行号）。
  // 在真实整篇渲染路径中，mdast 的 position 本身就是全局值，所以 base=0 就够用。
  void useBlockLineBase

  const mounted = virtualize ? visible.endIndex - visible.startIndex : model.blocks.length

  return (
    <div
      ref={scrollContainerRef}
      data-testid="prototype-scroll-container"
      style={{ overflowY: 'auto', height: '100%', width: '100%', position: 'relative' }}
    >
      {virtualize ? (
        <div
          data-testid="prototype-spacer"
          style={{ position: 'relative', height: visible.totalHeight, width: '100%' }}
        >
          {model.blocks.slice(visible.startIndex, visible.endIndex).map((block, relIdx) => {
            const absIdx = visible.startIndex + relIdx
            const top = visible.blockTops[absIdx] ?? 0
            // 块内局部 position 的 line=1 对应块真实 startLine，所以偏移 = startLine - 1
            const baseLine = block.startLine - 1
            const comps = buildBlockComponents(baseLine)
            const normalizedSlice = model.normalizedContent.slice(
              normalizedOffsetFromRaw(model, block.startOffset, 'start'),
              normalizedOffsetFromRaw(model, block.endOffset, 'end'),
            )
            return (
              <div
                key={block.blockId}
                data-md-block-index={absIdx}
                data-md-block-id={block.blockId}
                data-md-block-type={block.type}
                data-md-line={block.startLine}
                data-md-end-line={block.endLine}
                data-md-start-offset={block.startOffset}
                data-md-end-offset={block.endOffset}
                ref={(el) => {
                  blockRefs.current.set(absIdx, el)
                }}
                style={{ position: 'absolute', top, left: 0, right: 0 }}
                className="prototype-md-block"
              >
                {block.type === 'frontmatter' ? null : (
                  <ReactMarkdown
                    remarkPlugins={REMARK}
                    rehypePlugins={[rehypeKatex]}
                    components={comps}
                  >
                    {normalizedSlice}
                  </ReactMarkdown>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        // 非虚拟模式：整篇一次性 ReactMarkdown 渲染，position 是绝对行号，baseLine=0
        <div data-testid="prototype-spacer" style={{ position: 'relative' }}>
          <ReactMarkdown
            remarkPlugins={REMARK}
            rehypePlugins={[rehypeKatex]}
            components={buildBlockComponents(0)}
          >
            {model.normalizedContent}
          </ReactMarkdown>
        </div>
      )}
      {/* 调试数据层，便于基准脚本读取挂载范围 */}
      <div
        data-testid="prototype-stats"
        data-mounted-count={mounted}
        data-total-blocks={model.blocks.length}
        style={{ display: 'none' }}
      />
    </div>
  )
})

/* ------------------------- 公开的交互辅助（与 PrototypeMarkdownPreview 配合验证） ------------------------- */

/**
 * 跳转到指定源码行号对应的块顶部；即使该块尚未挂载，
 * 也先用高度估计定位，随后测量校正会由 useLayoutEffect 自然触发。
 */
export function scrollToLine(root: HTMLElement | null, line: number, model: MarkdownPreviewModel): boolean {
  if (!root) return false
  const container = root.querySelector<HTMLDivElement>('[data-testid="prototype-scroll-container"]')
  if (!container) return false
  const idx = findBlockIndexByLine(model, line)
  if (idx < 0) return false
  const existing = container.querySelector<HTMLDivElement>(`[data-md-block-index="${idx}"]`)
  if (existing) {
    existing.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
    return true
  }
  // 未挂载：用估算高度计算
  const fs = parseFloat(container.style.fontSize) || 14
  const lh = parseFloat(container.style.lineHeight) || 1.65
  const estimate = estimateForScroll(model, fs, lh)
  let top = 0
  for (let i = 0; i < idx; i += 1) top += estimate(model.blocks[i])
  container.scrollTop = top
  return true
}

/** 基于全文文本搜索，返回命中列表（不限于已挂载 DOM） */
export function searchPreview(model: MarkdownPreviewModel, query: string, limit = 100): SearchHit[] {
  return searchContent(model, query, limit)
}

/** 给定容器内点击坐标，返回命中块及原始 offset，用于模拟 Alt+点击预览内编辑。 */
export function resolvePreviewEditPoint(
  root: HTMLElement | null,
  clientX: number,
  clientY: number,
  model: MarkdownPreviewModel,
): { blockIndex: number; rawOffset: number; line: number } | null {
  if (!root) return null
  const el = document.elementFromPoint(clientX, clientY)
  if (!el || !root.contains(el)) return null
  const wrapper = el.closest<HTMLDivElement>('[data-md-block-index]')
  if (!wrapper) return null
  const idx = Number(wrapper.dataset.mdBlockIndex)
  if (!Number.isFinite(idx)) return null
  const block = model.blocks[idx]
  if (!block) return null
  // 简化：点击元素的 data-md-line（若有）对应行；没有时退回到块首行
  const lineEl = el.closest<HTMLElement>('[data-md-line]')
  const line = lineEl ? Number(lineEl.dataset.mdLine) : block.startLine
  const lineNo = Number.isFinite(line) ? line : block.startLine
  const local = Math.max(0, Math.min(block.endLine, lineNo) - block.startLine)
  const lineOffsetInBlock = offsetOfLineInSource(block.rawSource, local)
  return {
    blockIndex: idx,
    rawOffset: block.startOffset + lineOffsetInBlock,
    line: lineNo,
  }
}

/** 返回滚动同步锚点：当前可视区内第一个 heading 或段落块的行号。 */
export function currentSyncAnchor(root: HTMLElement | null, model: MarkdownPreviewModel): number | undefined {
  if (!root) return undefined
  const container = root.querySelector<HTMLDivElement>('[data-testid="prototype-scroll-container"]')
  if (!container) return undefined
  const nodes = container.querySelectorAll<HTMLDivElement>('[data-md-block-index]')
  if (!nodes.length) return undefined
  const cr = container.getBoundingClientRect()
  // 在 JSDOM / 无布局环境中所有 getBoundingClientRect 均为 0；退化取 DOM 顺序第一个可见块。
  let useFallback = cr.width === 0 && cr.height === 0
  if (!useFallback) {
    // 检查至少一个块非零
    const first = nodes[0]?.getBoundingClientRect()
    useFallback = !first || (first.width === 0 && first.height === 0)
  }
  if (useFallback) {
    const first = nodes[0]
    const idx = Number(first?.dataset.mdBlockIndex)
    const blk = Number.isFinite(idx) ? model.blocks[idx as number] : undefined
    return blk?.startLine
  }
  for (const n of Array.from(nodes)) {
    const r = n.getBoundingClientRect()
    if (r.bottom >= cr.top + 4) {
      const idx = Number(n.dataset.mdBlockIndex)
      const blk = model.blocks[idx]
      return blk?.startLine
    }
  }
  return undefined
}

/* ------------------------- 内部辅助 ------------------------- */

function buildHeading(
  level: number,
  emSize: number,
  headingIds: Map<string, number>,
  baseLine: number,
  onHeadingClick?: (line: number) => void,
): Components[`h${typeof level extends 1 | 2 | 3 | 4 ? typeof level : 2}`] {
  const Tag = `h${level}` as const
  // @ts-expect-error dynamic heading tag typing
  return ({ children, node }) => {
    const line = getNodeStartLine(node, baseLine)
    const text = getText(children)
    const id = line ? `heading-${line}` : createHeadingId(text, headingIds)
    const cls = level === 2 ? 'mt-8 mb-4' : level === 3 ? 'mt-6 mb-3' : 'mt-4 mb-2'
    return (
      // @ts-expect-error dynamic tag
      <Tag
        id={id}
        data-heading-id={id}
        data-md-line={line}
        onClick={() => line !== undefined && onHeadingClick?.(line)}
        className={`scroll-mt-6 font-bold ${cls}`}
        style={{ fontSize: `${emSize}em` }}
      >
        {children}
      </Tag>
    )
  }
}

function getNodeStartLine(node: unknown, base = 0): number | undefined {
  if (!node || typeof node !== 'object') return undefined
  const p = (node as { position?: { start?: { line?: unknown } } }).position
  const line = p?.start?.line
  if (typeof line !== 'number') return undefined
  return line + base
}

function getNodeEndLine(node: unknown, base = 0): number | undefined {
  if (!node || typeof node !== 'object') return undefined
  const p = (node as { position?: { end?: { line?: unknown } } }).position
  const line = p?.end?.line
  if (typeof line !== 'number') return undefined
  return line + base
}

function getText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getText).join('')
  if (node && typeof node === 'object' && 'props' in (node as React.ReactElement)) {
    return getText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ''
}

function countDescendantNodes(el: Element): number {
  let n = 0
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) n += 1
  return n
}

function offsetOfLineInSource(src: string, localLine: number): number {
  if (localLine <= 0) return 0
  let offset = 0
  let line = 0
  while (line < localLine && offset < src.length) {
    const m = /\r\n|\r|\n/.exec(src.slice(offset))
    if (!m) return src.length
    offset += m.index + m[0].length
    line += 1
  }
  return offset
}

function estimateForScroll(model: MarkdownPreviewModel, fontSize: number, lineHeight: number) {
  return (block: PreviewBlock): number => {
    const baseLinePx = fontSize * lineHeight
    const lines = Math.max(1, block.endLine - block.startLine + 1)
    switch (block.type) {
      case 'frontmatter':
        return 0
      case 'thematicBreak':
        return 32
      case 'heading':
        return baseLinePx * 1.8
      case 'code':
      case 'mermaid':
        return Math.max(40, (block.codeMeta?.lines ?? lines) * fontSize * 1.25 + 36)
      case 'table':
        return Math.max(48, (block.tableMeta?.rows ?? lines) * (baseLinePx + 8) + 32)
      case 'list':
        return Math.max(24, (block.listItemCount ?? lines) * baseLinePx * 1.2)
      default:
        return Math.max(20, lines * baseLinePx * 1.15 + 12)
    }
  }
}

/**
 * 从 raw offset 映射回 normalizedContent 的 offset（用于切片给 ReactMarkdown 渲染单块）。
 * 因为规范化只改变 \[\] ↔ $$ 与 CRLF → LF，长度基本对齐，逐字符扫描即可。
 */
function normalizedOffsetFromRaw(model: MarkdownPreviewModel, rawOffset: number, edge: 'start' | 'end'): number {
  const raw = model.rawContent
  const norm = model.normalizedContent
  if (rawOffset <= 0) return 0
  if (rawOffset >= raw.length) return norm.length
  let r = 0
  let n = 0
  while (r < rawOffset && r < raw.length && n < norm.length) {
    const rc = raw.charCodeAt(r)
    const nc = norm.charCodeAt(n)
    if (rc === nc) {
      r += 1
      n += 1
      continue
    }
    if (rc === 13 && raw.charCodeAt(r + 1) === 10 && nc === 10) {
      r += 2
      n += 1
      continue
    }
    if (r === 0 && rc === 0xfeff) {
      r += 1
      continue
    }
    r += 1
    n += 1
  }
  void edge
  return Math.min(norm.length, n)
}

export type { TocItem }
