import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReadingArtifact } from '@/services/database/readingArtifacts'
import type { ReadingMark } from '@/services/readingMarks'

const mocks = vi.hoisted(() => ({ loadPage: vi.fn() }))

vi.mock('@/services/database/readingArtifactCenter', () => ({
  loadReadingArtifactCenterItemsPage: mocks.loadPage,
  loadReadingArtifactDocumentSummariesPage: vi.fn().mockResolvedValue({ documents: [], total: 0, hasMore: false }),
}))
vi.mock('@/hooks/useTauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTauri')>()),
  fileExists: vi.fn().mockResolvedValue(false),
}))

import { ReadingArtifactCenter } from '@/components/reading-artifacts/ReadingArtifactCenter'
import { useReadingArtifactsStore } from '@/stores/readingArtifactsStore'
import { useReadingMarksStore } from '@/stores/readingMarksStore'

const originalDelete = useReadingArtifactsStore.getState().deleteArtifact
const originalRemove = useReadingMarksStore.getState().remove
let artifacts: ReadingArtifact[]
let marks: ReadingMark[]
let observers: { callback: IntersectionObserverCallback; disconnected: boolean }[]

async function loadNextPage(count: number) {
  await waitFor(() => expect(observers.some((observer) => !observer.disconnected)).toBe(true))
  act(() => {
    for (const observer of observers.filter((entry) => !entry.disconnected)) {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(count))
}

describe('ReadingArtifactCenter recent pagination refresh', () => {
  beforeEach(() => {
    observers = []
    vi.stubGlobal('IntersectionObserver', class {
      entry: typeof observers[number]
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, disconnected: false }
        observers.push(this.entry)
      }
      observe() {}
      disconnect() { this.entry.disconnected = true }
    })
    artifacts = Array.from({ length: 19 }, (_, index) => ({
      id: `artifact-${index}`, type: 'summary', title: `匿名成果 ${index}`,
      content: '匿名内容', source: null, status: 'active',
      createdAt: 1000 - index, updatedAt: 1000 - index,
    }))
    marks = [{
      id: 'mark-1', documentId: 'path:c:/anonymous/a.md', documentPath: 'C:/anonymous/A.md',
      type: 'annotation', color: 'yellow', note: '追加的人工批注', createdAt: 992.5, updatedAt: 992.5,
      anchor: {
        range: { startBlockId: 'pb-0', startOffset: 0, endBlockId: 'pb-0', endOffset: 4 },
        startOffset: 0, endOffset: 4, quote: '匿名原文', contextBefore: '', contextAfter: '',
      },
    }]
    mocks.loadPage.mockReset().mockImplementation(async ({ limit, offset, query }) => {
      const entries = [...artifacts, ...marks].filter((entry) => !query || ('title' in entry && entry.title.includes(query)))
        .sort((left, right) => right.createdAt - left.createdAt)
      const page = entries.slice(offset, offset + limit)
      return {
        artifacts: page.filter((entry) => 'title' in entry),
        marks: page.filter((entry) => !('title' in entry)),
        total: entries.length, hasMore: offset + limit < entries.length,
      }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useReadingArtifactsStore.setState({
      dataRevision: 0, anchorStatuses: {},
      deleteArtifact: vi.fn(async (id) => {
        artifacts = artifacts.filter((artifact) => artifact.id !== id)
        useReadingArtifactsStore.setState((state) => ({ dataRevision: state.dataRevision + 1 }))
      }),
    })
    useReadingMarksStore.setState({
      dataRevision: 0,
      remove: vi.fn(async (id) => {
        marks = marks.filter((mark) => mark.id !== id)
        useReadingMarksStore.setState((state) => ({ dataRevision: state.dataRevision + 1 }))
      }),
    })
  })

  afterEach(() => {
    cleanup()
    useReadingArtifactsStore.setState({ deleteArtifact: originalDelete, dataRevision: 0 })
    useReadingMarksStore.setState({ remove: originalRemove, dataRevision: 0 })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['ai', 'mark'] as const)('retains loaded cards and scroll after deleting an appended %s card', async (kind) => {
    render(<ReadingArtifactCenter onOpenAiSource={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5))
    expect(mocks.loadPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, offset: 0 }))
    for (const count of [10, 15]) {
      await loadNextPage(count)
    }
    const scroller = screen.getByRole('region', { name: '阅读成果内容' })
    scroller.scrollTop = 1800
    const retainedCard = screen.getByText('匿名成果 12').closest('article')
    const target = screen.getByText(kind === 'ai' ? '匿名成果 8' : '追加的人工批注').closest('article')!
    fireEvent.click(within(target).getByRole('button', { name: /^成果操作 / }))
    fireEvent.click(screen.getByRole('button', { name: '删除成果' }))
    await waitFor(() => expect(screen.queryByText(kind === 'ai' ? '匿名成果 8' : '追加的人工批注')).not.toBeInTheDocument())
    expect(screen.getAllByRole('article')).toHaveLength(15)
    expect(retainedCard).toBeInTheDocument()
    expect(scroller.scrollTop).toBe(1800)
    expect(mocks.loadPage.mock.calls.every(([options]) => options.limit <= 40)).toBe(true)
    await loadNextPage(19)
    expect(new Set(screen.getAllByRole('article').map((card) => card.textContent)).size).toBe(19)
    expect(screen.getByText('没有更多了')).toBeInTheDocument()
  })

  it('starts a new search at the first page after a data refresh', async () => {
    render(<ReadingArtifactCenter onOpenAiSource={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5))
    await loadNextPage(10)
    act(() => useReadingArtifactsStore.setState({ dataRevision: 1 }))
    await waitFor(() => expect(mocks.loadPage.mock.calls.filter(([options]) => options.offset === 0)).toHaveLength(2))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '匿名成果' } })
    await waitFor(() => expect(mocks.loadPage.mock.calls.at(-1)?.[0].query).toBe('匿名成果'))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5))
    expect(mocks.loadPage.mock.calls.at(-1)?.[0]).toMatchObject({ query: '匿名成果', offset: 0, limit: 5 })
  })

  it('discards a delayed refresh page after switching views', async () => {
    render(<ReadingArtifactCenter onOpenAiSource={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5))
    await loadNextPage(10)
    const loadPage = mocks.loadPage.getMockImplementation()!
    let resume!: () => void
    mocks.loadPage.mockImplementation(async (options) => {
      const page = await loadPage(options)
      if (options.offset === 5) await new Promise<void>((resolve) => { resume = resolve })
      return page
    })
    act(() => useReadingArtifactsStore.setState({ dataRevision: 1 }))
    await waitFor(() => expect(mocks.loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5, limit: 5 })))
    await waitFor(() => expect(resume).toBeDefined())
    fireEvent.click(screen.getByRole('tab', { name: '按文档' }))
    await act(async () => { resume() })
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    fireEvent.click(screen.getByRole('tab', { name: '最近' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5))
  })
})
