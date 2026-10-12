import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { StateField, StateEffect, Range, Compartment, Text } from '@codemirror/state'

// --- CodeMirror manual search via decorations ---

const markDeco = Decoration.mark({ class: 'cm-searchMatch' })
const activeDeco = Decoration.mark({ class: 'cm-searchMatch-selected' })

interface SearchState {
  query: string
  caseSensitive: boolean
  currentMatch: number
  matches: { from: number; to: number }[]
}

const setSearchQuery = StateEffect.define<SearchState>()
const clearSearch = StateEffect.define()

const searchField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchQuery)) {
        const { query, currentMatch, matches } = effect.value
        if (!query || matches.length === 0) return Decoration.none
        const decos: Range<Decoration>[] = matches.map((m, i) =>
          (i === currentMatch ? activeDeco : markDeco).range(m.from, m.to)
        )
        return Decoration.set(decos.sort((a, b) => a.from - b.from))
      }
      if (effect.is(clearSearch)) {
        return Decoration.none
      }
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

function findMatches(doc: string, query: string, caseSensitive: boolean): { from: number; to: number }[] {
  if (!query) return []
  const matches: { from: number; to: number }[] = []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi')
  let match: RegExpExecArray | null
  while ((match = regex.exec(doc)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length })
  }
  return matches
}

/**
 * 在匹配列表中选取离锚点（当前光标/视口 offset）最近的匹配下标。
 * - 无锚点或空列表 → 0（保持现状：跳文档首个匹配）。
 * - 距离相等时取 `from >= anchor` 的后者（搜索方向优先）。
 */
export function findNearestMatchIndex(matches: { from: number; to: number }[], anchor: number | undefined): number {
  if (matches.length === 0 || anchor === undefined) return 0
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < matches.length; i += 1) {
    const dist = Math.abs(matches[i].from - anchor)
    if (dist < bestDist || (dist === bestDist && matches[i].from >= anchor)) {
      best = i
      bestDist = dist
    }
  }
  return best
}

// --- Component ---

interface PreviewSearchHandle {
  scrollToOffset: (offset: number) => void
  setSearchState?: (state: { query: string; activeOffset?: number } | null) => void
  searchVisible?: (query: string) => Array<{ from: number; to: number }>
  getViewportOffset?: () => number | undefined
}

interface PreviewSource {
  content: string
  targetKey?: string
  ready?: boolean
  paneRef: React.RefObject<HTMLDivElement | null>
  previewRef: React.RefObject<PreviewSearchHandle | null>
}

interface SearchOverlayProps {
  onClose: () => void
  editorViewRef?: React.MutableRefObject<EditorView | null>
  editorView?: EditorView | null
  targetKey?: string
  searchRequest?: SearchRequest
  previewSources?: PreviewSource[]
}

export interface SearchRequest {
  requestId: number
  target: 'editor' | 'preview'
  initialQuery: string
  anchor?: { offset: number; sourceIndex?: number }
}

interface PreviewMatch {
  sourceIndex: number
  from: number
  to: number
}

interface SearchBinding {
  view: EditorView | null
  key?: string
  sources: Array<{ handle: PreviewSearchHandle | null; key?: string; content: string; ready: boolean }>
  compartment: Compartment
  alive: boolean
}

export function SearchOverlay({ onClose, editorViewRef, editorView, targetKey, searchRequest, previewSources = [] }: SearchOverlayProps) {
  const isEditor = !!editorViewRef
  const [query, setQuery] = useState(searchRequest?.initialQuery ?? '')
  const queryRef = useRef(query)
  const [replaceText, setReplaceText] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(-1)
  const currentMatchRef = useRef(-1)
  const matchesRef = useRef<PreviewMatch[]>([])
  const searchedDocRef = useRef<Text | null>(null)
  const bindingRef = useRef<SearchBinding | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const appliedSearchRequestIdRef = useRef<number | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  const requestOriginRef = useRef({ id: searchRequest?.requestId, key: targetKey, isEditor })

  const bindingIsCurrent = () => {
    const binding = bindingRef.current
    if (!binding || binding.key !== targetKey) return false
    if (isEditor) return !!binding.view && binding.alive && binding.view === editorViewRef?.current
      && (editorView === undefined || binding.view === editorView)
    return binding.view === null && binding.sources.length > 0 && binding.sources.length === previewSources.length
      && binding.sources.every((source, i) => source.ready && previewSources[i].ready !== false
        && source.handle === previewSources[i].previewRef.current && !!source.handle?.searchVisible
        && source.key === previewSources[i].targetKey && source.content === previewSources[i].content)
  }

  const syncHighlights = (active = -1) => {
    const binding = bindingRef.current
    if (!binding) return
    const matches = matchesRef.current
    if (binding.view && binding.alive) {
      binding.view.dispatch({ effects: setSearchQuery.of({ query: queryRef.current, caseSensitive: false, currentMatch: active, matches }) })
    } else {
      const selected = matches[active]
      binding.sources.forEach((source, index) => source.handle?.setSearchState?.(queryRef.current
        ? { query: queryRef.current, ...(selected?.sourceIndex === index ? { activeOffset: selected.from } : {}) }
        : null))
    }
  }

  // 只重建派生结果；自动刷新不选择、不滚动、不抢焦点。
  const refresh = () => {
    matchesRef.current = []
    searchedDocRef.current = null
    currentMatchRef.current = -1
    setCurrentMatch(-1)
    if (queryRef.current && bindingIsCurrent()) {
      const binding = bindingRef.current!
      if (binding.view) {
        searchedDocRef.current = binding.view.state.doc
        matchesRef.current = findMatches(binding.view.state.doc.toString(), queryRef.current, false)
          .map((match) => ({ ...match, sourceIndex: 0 }))
      } else {
        matchesRef.current = binding.sources.flatMap((source, sourceIndex) =>
          source.handle!.searchVisible!(queryRef.current).map((match) => ({ ...match, sourceIndex })))
      }
    }
    if (bindingIsCurrent()) syncHighlights()
    setMatchCount(matchesRef.current.length)
  }
  refreshRef.current = refresh

  const clearBinding = () => {
    const binding = bindingRef.current
    bindingRef.current = null
    if (!binding) return
    if (binding.view && binding.alive) {
      binding.view.dispatch({ effects: [clearSearch.of(null), binding.compartment.reconfigure([])] })
    }
    binding.sources.forEach((source) => source.handle?.setSearchState?.(null))
  }

  // ref 对象稳定不代表实例稳定。生产入口通过实例创建/模型提交通知触发渲染。
  useLayoutEffect(() => {
    const view = isEditor ? (editorView === undefined ? editorViewRef?.current ?? null : editorView) : null
    const sources = isEditor ? [] : previewSources.map((source) => ({
      handle: source.previewRef.current, key: source.targetKey, content: source.content,
      ready: source.ready !== false && !!source.previewRef.current?.searchVisible,
    }))
    const previous = bindingRef.current
    if (previous && previous.view === view && previous.key === targetKey
      && previous.sources.length === sources.length && previous.sources.every((source, i) =>
        source.handle === sources[i].handle && source.key === sources[i].key
        && source.content === sources[i].content && source.ready === sources[i].ready)) return
    clearBinding()
    const binding: SearchBinding = { view, key: targetKey, sources, compartment: new Compartment(), alive: true }
    bindingRef.current = binding
    if (view && binding.alive) {
      const listener = ViewPlugin.define(() => ({
        destroy() { binding.alive = false },
        update(update: ViewUpdate) {
          if (!update.docChanged) return
          // CM update 内不能 dispatch；坐标立即因 doc 身份失效，提交后再刷新。
          queueMicrotask(() => { if (bindingRef.current === binding && binding.alive && searchedDocRef.current !== view.state.doc) refreshRef.current() })
        },
      }))
      view.dispatch({ effects: StateEffect.appendConfig.of(binding.compartment.of([searchField, listener])) })
    }
    refreshRef.current()
  })

  useLayoutEffect(() => () => { clearBinding() }, [])

  const selectMatch = (index: number) => {
    if (!bindingIsCurrent()) return
    const match = matchesRef.current[index]
    if (!match) return
    currentMatchRef.current = index
    setCurrentMatch(index)
    const view = bindingRef.current?.view
    if (view) {
      view.dispatch({ selection: { anchor: match.from, head: match.to },
        effects: setSearchQuery.of({ query: queryRef.current, caseSensitive: false, currentMatch: index, matches: matchesRef.current }), scrollIntoView: true })
    } else {
      syncHighlights(index)
      bindingRef.current?.sources[match.sourceIndex].handle?.scrollToOffset(match.from)
    }
  }

  const previewAnchor = () => {
    const focusedIndex = previewSources.findIndex((source) => source.paneRef.current?.contains(document.activeElement))
    const sourceIndex = Math.max(0, focusedIndex)
    return { sourceIndex, offset: bindingRef.current?.sources[sourceIndex]?.handle?.getViewportOffset?.() ?? 0 }
  }

  const doSearch = (q: string, initialAnchor?: SearchRequest['anchor']) => {
    queryRef.current = q
    setQuery(q)
    refresh()
    if (!bindingIsCurrent() || !q) return
    const anchor = initialAnchor ?? (isEditor
      ? { offset: bindingRef.current!.view!.state.selection.main.head, sourceIndex: 0 }
      : previewAnchor())
    const candidates = matchesRef.current.filter((match) => match.sourceIndex === (anchor.sourceIndex ?? 0))
    const nearest = candidates[findNearestMatchIndex(candidates, anchor.offset)]
    if (nearest) selectMatch(matchesRef.current.indexOf(nearest))
  }

  const navigate = (direction: 1 | -1) => {
    if (!queryRef.current || !bindingIsCurrent()) return
    const view = bindingRef.current?.view
    if (view && searchedDocRef.current !== view.state.doc) refresh()
    const matches = matchesRef.current
    if (!matches.length) return
    let index = currentMatchRef.current
    if (index >= 0) index = (index + direction + matches.length) % matches.length
    else {
      const anchor = view ? { offset: view.state.selection.main.head, sourceIndex: 0 } : previewAnchor()
      if (direction === 1) {
        index = matches.findIndex((match) => match.sourceIndex > anchor.sourceIndex || (match.sourceIndex === anchor.sourceIndex && match.from >= anchor.offset))
        if (index < 0) index = 0
      } else {
        index = matches.length - 1
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          if (matches[i].sourceIndex < anchor.sourceIndex || (matches[i].sourceIndex === anchor.sourceIndex && matches[i].from <= anchor.offset)) { index = i; break }
        }
      }
    }
    selectMatch(index)
  }
  const handleNext = () => navigate(1)
  const handlePrev = () => navigate(-1)

  const handleReplace = () => {
    if (!isEditor || !queryRef.current || !bindingIsCurrent()) return
    const view = bindingRef.current!.view!
    if (searchedDocRef.current !== view.state.doc) refresh()
    const sel = view.state.selection.main
    if (matchesRef.current.some((match) => match.from === sel.from && match.to === sel.to)) {
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: replaceText }, selection: { anchor: sel.from + replaceText.length } })
      refresh()
    }
    navigate(1)
  }

  const handleReplaceAll = () => {
    if (!isEditor || !queryRef.current || !bindingIsCurrent()) return
    const view = bindingRef.current!.view!
    if (searchedDocRef.current !== view.state.doc) refresh()
    const changes = matchesRef.current.map((match) => ({ from: match.from, to: match.to, insert: replaceText }))
    if (changes.length) view.dispatch({ changes })
    refresh()
  }

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); navigate(e.shiftKey ? -1 : 1) }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])
  useEffect(() => { inputRef.current?.focus() }, [searchRequest?.requestId])

  useEffect(() => {
    if (!searchRequest?.initialQuery || appliedSearchRequestIdRef.current === searchRequest.requestId) return
    const origin = requestOriginRef.current
    if (origin.id !== searchRequest.requestId) requestOriginRef.current = { id: searchRequest.requestId, key: targetKey, isEditor }
    else if (origin.key !== targetKey || origin.isEditor !== isEditor) {
      appliedSearchRequestIdRef.current = searchRequest.requestId
      return
    }
    if (!bindingIsCurrent()) return
    appliedSearchRequestIdRef.current = searchRequest.requestId
    doSearch(searchRequest.initialQuery, searchRequest.anchor)
  })

  return (
    <div
      data-editor-search-overlay
      data-search-target={isEditor ? 'editor' : 'preview'}
      className="absolute top-2 right-2 z-50 bg-gm-surface border border-gm-border rounded-xl shadow-lg p-3 min-w-[300px]"
    >
      <div className="flex flex-col gap-2">
        {/* Search row */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { appliedSearchRequestIdRef.current = searchRequest?.requestId ?? null; doSearch(e.target.value) }}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索..."
            className="flex-1 h-8 px-3 text-caption text-gm-text bg-gm-canvas border border-gm-border rounded-lg outline-none focus:border-gm-primary transition-colors"
          />
          <button onClick={handlePrev} className="p-1.5 rounded-lg text-gm-text-tertiary hover:text-gm-text hover:bg-gm-surface-hover transition-colors" title="上一个 (Shift+Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
          </button>
          <button onClick={handleNext} className="p-1.5 rounded-lg text-gm-text-tertiary hover:text-gm-text hover:bg-gm-surface-hover transition-colors" title="下一个 (Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {query && (
            <span className="text-micro text-gm-text-tertiary whitespace-nowrap min-w-[40px] text-center">
              {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : '无'}
            </span>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-gm-text-tertiary hover:text-gm-text hover:bg-gm-surface-hover transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Replace row (editor only) */}
        {isEditor && (
          <div className="flex items-center gap-2">
            <input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="替换..."
              className="flex-1 h-8 px-3 text-caption text-gm-text bg-gm-canvas border border-gm-border rounded-lg outline-none focus:border-gm-primary transition-colors"
            />
            <button onClick={handleReplace} className="px-2.5 py-1.5 text-micro font-bold text-gm-text-secondary hover:text-gm-text bg-gm-surface-hover hover:bg-gm-surface-overlay rounded-lg transition-colors whitespace-nowrap">
              替换
            </button>
            <button onClick={handleReplaceAll} className="px-2.5 py-1.5 text-micro font-bold text-gm-text-secondary hover:text-gm-text bg-gm-surface-hover hover:bg-gm-surface-overlay rounded-lg transition-colors whitespace-nowrap">
              全部替换
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
