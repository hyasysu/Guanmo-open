/**
 * Markdown 预览单次解析文档模型
 *
 * 设计目标：
 * 1. 全文只执行一次 remark 解析，产出稳定的顶层块描述
 * 2. 每个块保留原始 startOffset/endOffset、startLine/endLine，供预览内编辑使用
 * 3. 模型一次性产出 reference definitions、footnote definitions、heading IDs 等全局信息，
 *    避免可视区块渲染时丢失跨块上下文
 * 4. 同时供隔离原型和生产 MarkdownPreview 使用，不引入 Worker 或新增依赖
 */

import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { createHeadingId, type TocItem } from '@/services/markdownToc'

export type PreviewBlockType =
  | 'frontmatter'
  | 'heading'
  | 'thematicBreak'
  | 'paragraph'
  | 'image'
  | 'list'
  | 'blockquote'
  | 'code'
  | 'mermaid'
  | 'math'
  | 'table'
  | 'html'
  | 'definition'
  | 'footnoteDefinition'
  | 'unknown'

export interface PreviewBlock {
  /** 稳定、不可变的块 ID，基于块在全文的索引 + 类型签名；可用于 React key 与缓存键 */
  blockId: string
  type: PreviewBlockType
  startLine: number
  endLine: number
  /** 原始 Markdown 中的 offset；用于预览内编辑与冲突检测 */
  startOffset: number
  endOffset: number
  /** LaTeX 规范化后内容中的 offset；用于 ReactMarkdown 按块切片渲染 */
  normalizedStartOffset: number
  normalizedEndOffset: number
  /** 原始 Markdown 切片；用于预览内编辑与冲突检测 */
  rawSource: string
  /**
   * 当块为 heading 时填充，用于目录跳转与 heading ID 去重；
   * 其他块保持 undefined，避免额外开销。
   */
  heading?: {
    id: string
    text: string
    level: number
  }
  /** 当块为 list 时记录顶层项数，用于粗略高度估计 */
  listItemCount?: number
  /** 当块为 code/mermaid 时记录语言与行数，用于粗略高度估计 */
  codeMeta?: {
    lang?: string
    lines: number
  }
  /** 当块为 table 时记录行/列数，用于粗略高度估计 */
  tableMeta?: {
    rows: number
    cols: number
  }
}

export interface ReferenceDefinition {
  identifier: string
  label?: string
  url: string
  title?: string
}

export interface FootnoteDefinition {
  identifier: string
  label?: string
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
}

export interface MarkdownPreviewModel {
  /** 原始全文内容（未规范化 LaTeX），供预览内编辑写回 */
  rawContent: string
  /** LaTeX 规范化后的内容，用于统一交给 ReactMarkdown 渲染单个块 */
  normalizedContent: string
  blocks: PreviewBlock[]
  /** 全文 reference definitions；跨块引用链接需要共享同一张表 */
  definitions: ReferenceDefinition[]
  /** 全文 footnote definitions */
  footnoteDefinitions: FootnoteDefinition[]
  /** 目录，按出现顺序，ID 已去重 */
  toc: TocItem[]
  /** 用于按 startOffset 二分查找块的辅助数组；不作为对外 API */
  _blockStartOffsets: number[]
}

interface MdastPositioned {
  type: string
  lang?: string | null
  children?: MdastPositioned[]
  value?: string
  identifier?: string
  label?: string
  url?: string
  title?: string
  position?: {
    start?: { line?: number; offset?: number; column?: number }
    end?: { line?: number; offset?: number; column?: number }
  }
}

const remarkParser = remark().use(remarkGfm).use(remarkMath)

export function createMarkdownPreviewModel(rawContent: string): MarkdownPreviewModel {
  const normalizedContent = normalizeLatexForModel(rawContent)
  const root = remarkParser.parse(normalizedContent) as unknown as {
    children: MdastPositioned[]
  }

  const frontmatter = extractFrontmatterRange(normalizedContent)
  const blocks: PreviewBlock[] = []
  const definitions: ReferenceDefinition[] = []
  const footnoteDefinitions: FootnoteDefinition[] = []
  const toc: TocItem[] = []
  const headingIds = new Map<string, number>()

  if (frontmatter) {
    blocks.push({
      blockId: makeBlockId('frontmatter', 0, normalizedContent.slice(0, frontmatter.endOffset)),
      type: 'frontmatter',
      startLine: 1,
      endLine: frontmatter.endLine,
      startOffset: 0,
      endOffset: frontmatter.endOffset,
      normalizedStartOffset: 0,
      normalizedEndOffset: frontmatter.endOffset,
      rawSource: rawContent.slice(0, frontmatter.endOffset),
    })
  }

  let blockIndex = blocks.length
  const children = root.children ?? []
  for (const node of children) {
    const startOffset = node.position?.start?.offset
    const endOffset = node.position?.end?.offset
    const startLine = node.position?.start?.line
    const endLine = node.position?.end?.line
    if (
      typeof startOffset !== 'number'
      || typeof endOffset !== 'number'
      || typeof startLine !== 'number'
      || typeof endLine !== 'number'
    ) continue
    if (frontmatter && endOffset <= frontmatter.endOffset) continue

    const type = classifyBlockType(node)
    if (type === 'definition') {
      if (node.identifier && node.url) {
        definitions.push({
          identifier: node.identifier.toLowerCase(),
          label: node.label,
          url: node.url,
          title: node.title,
        })
      }
      continue
    }
    if (type === 'footnoteDefinition') {
      if (node.identifier) {
        footnoteDefinitions.push({
          identifier: node.identifier.toLowerCase(),
          label: node.label,
          startLine,
          endLine,
          startOffset,
          endOffset,
        })
      }
      // footnote definition 仍然作为可见块保留，但放入 definitions 表中供引用解析
    }

    // LaTeX 规范化只做等长定界符替换，原文与规范化内容的 offset 始终一致。
    const rawStart = startOffset
    const rawEnd = endOffset
    const rawSource = rawContent.slice(rawStart, rawEnd)
    const block: PreviewBlock = {
      blockId: makeBlockId(type, blockIndex, normalizedContent.slice(startOffset, Math.min(startOffset + 120, endOffset))),
      type,
      startLine,
      endLine,
      startOffset: rawStart,
      endOffset: rawEnd,
      normalizedStartOffset: startOffset,
      normalizedEndOffset: endOffset,
      rawSource,
    }

    if (type === 'heading') {
      const text = extractHeadingText(node)
      if (text) {
        const id = createHeadingId(text, headingIds)
        block.heading = { id, text, level: extractHeadingLevel(node) }
        toc.push({ id, text, level: block.heading.level, line: startLine })
      }
    } else if (type === 'list') {
      block.listItemCount = countDirectChildren(node, 'listItem')
    } else if (type === 'code' || type === 'mermaid') {
      const value = node.value ?? normalizedContent.slice(startOffset, endOffset)
      block.codeMeta = {
        lang: type === 'mermaid' ? 'mermaid' : node.lang ?? undefined,
        lines: countLines(value),
      }
    } else if (type === 'table') {
      block.tableMeta = estimateTableMeta(node)
    }

    blocks.push(block)
    blockIndex += 1
  }

  const _blockStartOffsets = blocks.map((b) => b.startOffset)
  return {
    rawContent,
    normalizedContent,
    blocks,
    definitions,
    footnoteDefinitions,
    toc,
    _blockStartOffsets,
  }
}

/**
 * 返回一个块的 [startIndex, endIndex) 可见范围。
 * viewportStart/viewportEnd 使用像素高度；estimateBlockHeight 提供块高估计。
 * overscanBlocks 控制可视区上下额外挂载的块数量，默认 5。
 */
export function computeVisibleRange(
  model: MarkdownPreviewModel,
  viewportStart: number,
  viewportEnd: number,
  measuredHeights: Map<string, number>,
  estimateBlockHeight: (block: PreviewBlock, index: number) => number,
  overscanBlocks = 5,
): { startIndex: number; endIndex: number; blockTops: number[]; totalHeight: number } {
  const { blocks } = model
  const blockTops: number[] = []
  let cursor = 0
  for (let i = 0; i < blocks.length; i += 1) {
    blockTops.push(cursor)
    const measured = measuredHeights.get(blocks[i].blockId)
    cursor += measured ?? estimateBlockHeight(blocks[i], i)
  }
  const totalHeight = cursor

  let startIndex = 0
  for (let i = 0; i < blocks.length; i += 1) {
    const bottom = i + 1 < blocks.length ? blockTops[i + 1] : totalHeight
    if (bottom >= viewportStart) {
      startIndex = i
      break
    }
    if (i === blocks.length - 1) startIndex = i
  }

  let endIndex = blocks.length
  for (let i = startIndex; i < blocks.length; i += 1) {
    const top = blockTops[i]
    if (top > viewportEnd) {
      endIndex = i
      break
    }
  }

  startIndex = Math.max(0, startIndex - overscanBlocks)
  endIndex = Math.min(blocks.length, endIndex + overscanBlocks)
  return { startIndex, endIndex, blockTops, totalHeight }
}

/** 根据原始 Markdown offset 二分查找所属块索引；未命中返回 -1 */
export function findBlockIndexByOffset(model: MarkdownPreviewModel, rawOffset: number): number {
  const starts = model._blockStartOffsets
  let lo = 0
  let hi = starts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const blk = model.blocks[mid]
    if (rawOffset < blk.startOffset) hi = mid - 1
    else if (rawOffset >= blk.endOffset) lo = mid + 1
    else return mid
  }
  return -1
}

/** 根据源码行号查找块索引；未命中返回 -1 */
export function findBlockIndexByLine(model: MarkdownPreviewModel, line: number): number {
  for (let i = 0; i < model.blocks.length; i += 1) {
    const blk = model.blocks[i]
    if (line >= blk.startLine && line <= blk.endLine) return i
  }
  return -1
}

/** 基于全文文本搜索，返回命中列表（即使对应块尚未挂载也能定位） */
export interface SearchHit {
  blockIndex: number
  startOffset: number
  endOffset: number
  line: number
  snippet: string
}

export function searchContent(model: MarkdownPreviewModel, query: string, limit = 100): SearchHit[] {
  if (!query) return []
  const lower = query.toLowerCase()
  const src = model.rawContent
  const hits: SearchHit[] = []
  let from = 0
  while (hits.length < limit) {
    const idx = src.toLowerCase().indexOf(lower, from)
    if (idx < 0) break
    const line = 1 + countLines(src.slice(0, idx))
    const blockIndex = findBlockIndexByOffset(model, idx)
    const snippetStart = Math.max(0, idx - 30)
    const snippetEnd = Math.min(src.length, idx + query.length + 30)
    hits.push({
      blockIndex,
      startOffset: idx,
      endOffset: idx + query.length,
      line,
      snippet: src.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ').trim(),
    })
    from = idx + Math.max(1, query.length)
  }
  return hits
}

/**
 * 根据源码行号估算预览容器中的滚动位置（像素），即使目标块尚未挂载也能返回合理估计。
 * measureHeights 为可选的真实测量高度映射，用于已挂载块的精确校正。
 */
export function getEstimatedPreviewTopForLine(
  model: MarkdownPreviewModel,
  line: number,
  estimateBlockHeight: (block: PreviewBlock, index: number) => number,
  measuredHeights?: Map<string, number>,
): number | undefined {
  const { blocks } = model
  let cursor = 0
  for (let i = 0; i < blocks.length; i += 1) {
    const blk = blocks[i]
    const h = measuredHeights?.get(blk.blockId) ?? estimateBlockHeight(blk, i)
    if (line >= blk.startLine && line <= blk.endLine) {
      const progress = blk.endLine > blk.startLine
        ? (line - blk.startLine) / (blk.endLine - blk.startLine)
        : 0
      return cursor + h * progress
    }
    cursor += h
  }
  return cursor > 0 ? cursor : undefined
}

/* ----------------------------- 内部辅助 ----------------------------- */

function makeBlockId(type: string, index: number, seed: string): string {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `pb-${type}-${index}-${(hash >>> 0).toString(36)}`
}

function classifyBlockType(node: MdastPositioned): PreviewBlockType {
  if (node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'image') {
    return 'image'
  }
  if (node.type === 'code') {
    return node.lang?.toLowerCase() === 'mermaid' ? 'mermaid' : 'code'
  }
  switch (node.type) {
    case 'heading':
    case 'thematicBreak':
    case 'paragraph':
    case 'list':
    case 'blockquote':
    case 'math':
    case 'table':
    case 'html':
    case 'definition':
    case 'footnoteDefinition':
      return node.type
    default:
      return 'unknown'
  }
}

function extractHeadingText(node: MdastPositioned): string {
  const out: string[] = []
  const walk = (n: MdastPositioned) => {
    if (typeof n.value === 'string') out.push(n.value)
    for (const c of n.children ?? []) walk(c)
  }
  walk(node)
  return out.join('').trim()
}

function extractHeadingLevel(node: MdastPositioned): number {
  // @ts-expect-error mdast heading node has depth
  const d = node.depth as unknown
  return typeof d === 'number' && d >= 1 && d <= 6 ? d : 2
}

function countDirectChildren(node: MdastPositioned, typeName: string): number {
  let n = 0
  for (const c of node.children ?? []) if (c.type === typeName) n += 1
  return n
}

function estimateTableMeta(node: MdastPositioned): { rows: number; cols: number } {
  let rows = 0
  let cols = 0
  for (const c of node.children ?? []) {
    if (c.type === 'tableRow' || c.type === 'tableHeader') {
      rows += 1
      let cc = 0
      for (const cell of c.children ?? []) if (cell.type === 'tableCell') cc += 1
      cols = Math.max(cols, cc)
    }
  }
  return { rows, cols }
}

function countLines(text: string): number {
  if (!text) return 1
  let n = 1
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    if (ch === 10) n += 1
    else if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) i += 1
      n += 1
    }
  }
  return n
}

/**
 * 对模型内部使用的 LaTeX 规范化；保持与生产 MarkdownPreview 中
 * normalizeLatexBlockDelimiters 相同语义，但不引入跨模块副作用缓存。
 */
function normalizeLatexForModel(markdown: string): string {
  const parts = markdown.split(/(\r?\n)/)
  const lines = parts.filter((_, index) => index % 2 === 0)
  const pairedDelimiterLines = new Set<number>()
  let fence: { marker: '`' | '~'; length: number } | null = null
  let openingLine: number | null = null

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) {
        fence = { marker, length: fenceMatch[1].length }
      } else if (marker === fence.marker && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      return
    }
    if (fence) return
    const trimmed = line.trim()
    if (trimmed === '\\[' && openingLine === null) {
      openingLine = index
      return
    }
    if (trimmed === '\\]' && openingLine !== null) {
      pairedDelimiterLines.add(openingLine)
      pairedDelimiterLines.add(index)
      openingLine = null
    }
  })

  let lineIndex = 0
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      const currentLine = lineIndex++
      if (pairedDelimiterLines.has(currentLine)) {
        return part.replace(/\\(\[|\])/, () => '$$')
      }
      if (/^\s{0,3}\\\[.*\\\]\s*$/.test(part)) {
        return part
          .replace('\\[', () => '$$')
          .replace(/\\\](\s*)$/, (_, trailing: string) => `$$${trailing}`)
      }
      return part
    })
    .join('')
}

function extractFrontmatterRange(content: string): { endOffset: number; endLine: number } | null {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/.exec(content)
  if (!match) return null
  return {
    endOffset: match[0].length,
    endLine: 1 + countLines(match[0]),
  }
}
