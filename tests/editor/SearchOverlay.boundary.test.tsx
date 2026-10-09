import { createRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchOverlay } from '@/components/editor/SearchOverlay'
import { CodeMirrorEditor } from '@/components/editor/CodeMirrorEditor'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/services/eventMarker', () => ({ eventMarker: { mark: vi.fn() } }))
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()

const views: EditorView[] = []
function makeView(doc: string) {
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.createElement('div') })
  views.push(view)
  return view
}
afterEach(() => { views.splice(0).forEach((view) => view.destroy()) })

describe('搜索会话边界', () => {
  it('真实 CodeMirror 重建后保留输入并绑定新实例', () => {
    const viewRef = { current: null as EditorView | null }
    function Harness({ id, content }: { id: string; content: string }) {
      const [view, setView] = useState<EditorView | null>(null)
      return <>
        <CodeMirrorEditor documentKey={id} content={content} onChange={vi.fn()} viewRef={viewRef} onViewChange={setView} />
        <SearchOverlay onClose={vi.fn()} editorViewRef={viewRef} editorView={view} targetKey={id} />
      </>
    }
    const { rerender } = render(<Harness id="A" content="目标 目标" />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    expect(screen.getByText('1/2')).toBeInTheDocument()
    rerender(<Harness id="B" content="前文 目标" />)
    expect(screen.getByPlaceholderText('搜索...')).toHaveValue('目标')
    expect(screen.getByText('0/1')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('下一个 (Enter)'))
    expect(viewRef.current?.state.selection.main.from).toBe(3)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '前文' } })
    expect(viewRef.current?.state.selection.main.from).toBe(0)
  })

  it('正文 transaction 立即废弃旧坐标，刷新不移动光标', async () => {
    const view = makeView('目标 目标')
    render(<SearchOverlay onClose={vi.fn()} editorViewRef={{ current: view }} />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    await act(async () => { view.dispatch({ changes: { from: 0, to: 5, insert: '很长的新前文 目标' }, selection: { anchor: 0 } }) })
    expect(screen.getByText('0/1')).toBeInTheDocument()
    expect(view.state.selection.main.head).toBe(0)
    fireEvent.keyDown(screen.getByPlaceholderText('搜索...'), { key: 'Enter' })
    expect(view.state.selection.main.from).toBe(7)
  })

  it.each(['', 'x', '更长替换内容'])('单次替换为 %j 后使用新匹配而非旧 offset', async (replacement) => {
    const view = makeView('目标 目标')
    render(<SearchOverlay onClose={vi.fn()} editorViewRef={{ current: view }} />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    fireEvent.change(screen.getByPlaceholderText('替换...'), { target: { value: replacement } })
    await act(async () => { fireEvent.click(screen.getByText('替换', { exact: true })) })
    expect(view.state.doc.toString()).toBe(`${replacement} 目标`)
    expect(view.state.selection.main.from).toBe(replacement.length + 1)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('模式/预览文档切换自动刷新而不重播初始锚点，清理实际目标', () => {
    const view = makeView('目标 目标')
    const paneRef = createRef<HTMLDivElement>()
    const a = { searchVisible: vi.fn(() => [{ from: 10, to: 12 }]), setSearchState: vi.fn(), scrollToOffset: vi.fn() }
    const b = { searchVisible: vi.fn(() => [{ from: 30, to: 32 }, { from: 40, to: 42 }]), setSearchState: vi.fn(), scrollToOffset: vi.fn() }
    const request = { requestId: 1, target: 'editor' as const, initialQuery: '目标', anchor: { offset: 3 } }
    const { rerender, unmount } = render(<SearchOverlay onClose={vi.fn()} editorViewRef={{ current: view }} searchRequest={request} />)
    rerender(<SearchOverlay onClose={vi.fn()} searchRequest={request} previewSources={[{ content: 'A', targetKey: 'A', paneRef, previewRef: { current: a } }]} />)
    expect(screen.getByText('0/1')).toBeInTheDocument()
    expect(a.scrollToOffset).not.toHaveBeenCalled()
    rerender(<SearchOverlay onClose={vi.fn()} searchRequest={request} previewSources={[{ content: 'B', targetKey: 'B', paneRef, previewRef: { current: b } }]} />)
    expect(screen.getByText('0/2')).toBeInTheDocument()
    expect(a.setSearchState).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByTitle('下一个 (Enter)'))
    expect(b.scrollToOffset).toHaveBeenLastCalledWith(30)
    unmount()
    expect(b.setSearchState).toHaveBeenLastCalledWith(null)
  })

  it('handle 未就绪不扫源码，初始请求就绪后消费一次', () => {
    const paneRef = createRef<HTMLDivElement>()
    const previewRef = { current: null as null | { searchVisible: () => { from: number; to: number }[]; scrollToOffset: ReturnType<typeof vi.fn> } }
    const request = { requestId: 1, target: 'preview' as const, initialQuery: '目标', anchor: { offset: 8 } }
    const { rerender } = render(<SearchOverlay onClose={vi.fn()} searchRequest={request} previewSources={[{ content: '目标 目标', paneRef, previewRef }]} />)
    expect(screen.getByText('无')).toBeInTheDocument()
    const scrollToOffset = vi.fn()
    previewRef.current = { scrollToOffset, searchVisible: () => [{ from: 8, to: 10 }] }
    rerender(<SearchOverlay onClose={vi.fn()} searchRequest={request} previewSources={[{ content: '目标 目标', paneRef, previewRef }]} />)
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(scrollToOffset).toHaveBeenCalledOnce()
  })

  it('同内容不同文件与设置重建均废弃活动项，替换文本保留', () => {
    const viewRef = { current: null as EditorView | null }
    function Harness({ id }: { id: string }) {
      const [view, setView] = useState<EditorView | null>(null)
      return <>
        <CodeMirrorEditor documentKey={id} content="目标 目标" onChange={vi.fn()} viewRef={viewRef} onViewChange={setView} />
        <SearchOverlay onClose={vi.fn()} editorViewRef={viewRef} editorView={view} targetKey={id} />
      </>
    }
    const { rerender } = render(<Harness id="A" />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    fireEvent.change(screen.getByPlaceholderText('替换...'), { target: { value: '保留' } })
    rerender(<Harness id="B" />)
    expect(screen.getByText('0/2')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('替换...')).toHaveValue('保留')
    fireEvent.click(screen.getByTitle('下一个 (Enter)'))
    const oldView = viewRef.current
    const settings = useSettingsStore.getState().editor
    act(() => useSettingsStore.setState({ editor: { ...settings, fontSize: settings.fontSize + 1 } }))
    expect(viewRef.current).not.toBe(oldView)
    expect(screen.getByText('0/2')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByPlaceholderText('搜索...'), { key: 'Enter', shiftKey: true })
    expect(screen.getByText('1/2')).toBeInTheDocument()
    act(() => useSettingsStore.setState({ editor: settings }))
  })

  it.each(['', '$&', '目标目标'])('全部替换为 %j 使用一次有效快照与字面文本', async (replacement) => {
    const view = makeView('目标 目标')
    render(<SearchOverlay onClose={vi.fn()} editorViewRef={{ current: view }} />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    fireEvent.change(screen.getByPlaceholderText('替换...'), { target: { value: replacement } })
    await act(async () => { fireEvent.click(screen.getByText('全部替换')) })
    expect(view.state.doc.toString()).toBe(`${replacement} ${replacement}`)
    expect(screen.getByText(replacement === '目标目标' ? '0/4' : '无')).toBeInTheDocument()
  })

  it('关闭后待刷新回调不能复活高亮或改变普通选区', async () => {
    const view = makeView('目标 目标')
    const { unmount } = render(<SearchOverlay onClose={vi.fn()} editorViewRef={{ current: view }} />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: '前文 ' }, selection: { anchor: 0, head: 2 } })
      unmount()
    })
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(2)
    expect(view.dom.querySelector('.cm-searchMatch')).toBeNull()
    // 当前 search compartment 已卸载，后续正文 transaction 不再触发 overlay 刷新。
    act(() => view.dispatch({ changes: { from: 0, insert: '新' } }))
    expect(screen.queryByPlaceholderText('搜索...')).not.toBeInTheDocument()
  })

  it('清空关键词立即清理编辑/预览搜索层，不移动光标', () => {
    const view = makeView('目标 目标')
    const paneRef = createRef<HTMLDivElement>()
    const preview = { searchVisible: vi.fn(() => [{ from: 0, to: 2 }]), setSearchState: vi.fn(), scrollToOffset: vi.fn() }
    const { rerender } = render(<SearchOverlay onClose={vi.fn()} editorViewRef={{ current: view }} />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    const selection = view.state.selection.main
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '' } })
    expect(view.dom.querySelector('.cm-searchMatch')).toBeNull()
    expect(view.dom.querySelector('.cm-searchMatch-selected')).toBeNull()
    expect(view.state.selection.main).toEqual(selection)
    rerender(<SearchOverlay onClose={vi.fn()} previewSources={[{ content: '目标', paneRef, previewRef: { current: preview } }]} />)
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '' } })
    expect(preview.setSearchState).toHaveBeenLastCalledWith(null)
    expect(preview.searchVisible).toHaveBeenCalledOnce()
  })

  it('空词不扫描；双来源未就绪时不使用半份结果，身份切换后反向从视口选取', () => {
    const paneRef = createRef<HTMLDivElement>()
    const a = { searchVisible: vi.fn(() => [{ from: 10, to: 12 }, { from: 30, to: 32 }]), setSearchState: vi.fn(), scrollToOffset: vi.fn(), getViewportOffset: () => 20 }
    const b = { searchVisible: vi.fn(() => [{ from: 0, to: 2 }]), setSearchState: vi.fn(), scrollToOffset: vi.fn() }
    const sources = [{ content: 'A', targetKey: 'A', paneRef, previewRef: { current: a } }, { content: 'B', targetKey: 'B', paneRef, previewRef: { current: b } }]
    const { rerender } = render(<SearchOverlay onClose={vi.fn()} previewSources={sources} />)
    expect(a.searchVisible).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '目标' } })
    rerender(<SearchOverlay onClose={vi.fn()} previewSources={[sources[0], { ...sources[1], ready: false }]} />)
    expect(screen.getByText('无')).toBeInTheDocument()
    rerender(<SearchOverlay onClose={vi.fn()} previewSources={sources} />)
    expect(screen.getByText('0/3')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByPlaceholderText('搜索...'), { key: 'Enter', shiftKey: true })
    expect(a.scrollToOffset).toHaveBeenLastCalledWith(10)
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })
})
