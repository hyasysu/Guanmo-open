import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useFileOperations } from '@/hooks/useFileOperations'
import { saveDocument, saveDocumentAs, persistDocumentContent } from '@/services/documentSave'
import { scheduleMarkdownDocumentIndex } from '@/services/rag/indexer'
import { toast } from '@/services/toast'
import { saveExistingFileAs, saveTabAsFile } from '@/services/fileEntryActions'

const writer = vi.hoisted(() => vi.fn())
const picker = vi.hoisted(() => vi.fn())
vi.mock('@/services/fileSystem', () => ({ openFile: vi.fn(), saveFile: writer, saveFileAs: vi.fn(), selectSaveTarget: picker }))
vi.mock('@/services/rag/indexer', () => ({ scheduleMarkdownDocumentIndex: vi.fn() }))
vi.mock('@/hooks/useTauri', () => ({ isTauri: () => true }))
vi.mock('@/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/persistedFileAccess', () => ({ readRememberedFile: vi.fn().mockResolvedValue('anonymous disk content') }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  writer.mockReset().mockResolvedValue('written')
  picker.mockReset()
  useEditorStore.setState({ tabs: [] })
  useSettingsStore.setState({ editor: { ...useSettingsStore.getState().editor, autoSave: false } })
  useEditorStore.setState({ tabs: [{ id: 'save-a', title: 'a.md', filePath: 'X:/anon/a.md', content: 'A', savedContent: '', originalContent: '', modified: true }], activeTabId: 'save-a' })
})
afterEach(() => { useSettingsStore.setState({ editor: { ...useSettingsStore.getState().editor, autoSave: false } }); vi.useRealTimers() })

function edit(content: string) { useEditorStore.getState().updateTabContent('save-a', content) }
function autoSave(enabled = true) {
  useSettingsStore.setState({ editor: { ...useSettingsStore.getState().editor, autoSave: enabled, autoSaveDelay: 100 } })
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve() }

it('生产手动入口：阻塞 A 时 B/C 合并，完成 A 不覆盖正文 C', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
  const { result } = renderHook(() => useFileOperations())
  let a!: Promise<void>
  let b!: Promise<void>
  let c!: Promise<void>
  act(() => { a = result.current.handleSaveFile() })
  act(() => {
    useEditorStore.getState().updateTabContent('save-a', 'B')
    b = result.current.handleSaveFile()
    useEditorStore.getState().updateTabContent('save-a', 'C')
    c = result.current.handleSaveFile()
  })
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A'])
  await act(async () => { first.resolve(); await Promise.all([a, b, c]) })
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'C'])
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'C', savedContent: 'C', modified: false })
})

it('成功 A 时正文 B 保留，回执不能声称当前内容已保存', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a')
  edit('B')
  first.resolve()
  expect(await a).toMatchObject({ content: 'A', currentSaved: false })
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'B', savedContent: 'A', modified: true })
  expect(writer).toHaveBeenCalledTimes(1)
})

it('不同路径独立推进，路径变体与重复请求共用同路径锁', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a')
  useEditorStore.setState((state) => ({ tabs: [...state.tabs.map((t) => ({ ...t, filePath: 'x:\\anon\\A.md' })), { ...state.tabs[0], id: 'save-b', filePath: 'X:/anon/b.md', content: 'other' }] }))
  const duplicate = saveDocument('save-a')
  const other = saveDocument('save-b')
  await other
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'other'])
  first.resolve()
  await Promise.all([a, duplicate])
  expect(writer).toHaveBeenCalledTimes(2)
})

it('预览勾选保存中继续编辑不会被旧快照覆盖', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const saving = persistDocumentContent('save-a', '- [x] task')
  edit('- [x] task\nnew text')
  first.resolve()
  await saving
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: '- [x] task\nnew text', savedContent: '- [x] task', modified: true })
})

it('自动保存轮次追上未到防抖时间的新正文，两个 Hook 不重复写入', async () => {
  vi.useFakeTimers()
  autoSave()
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  renderHook(() => useFileOperations())
  renderHook(() => useFileOperations())
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(writer).toHaveBeenCalledTimes(1)
  act(() => { edit('C') })
  await act(async () => { first.resolve(); await flush() })
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'C'])
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(writer).toHaveBeenCalledTimes(2)
})

it('自动失败重试取最新内容，三次停止，手动新一轮可恢复', async () => {
  vi.useFakeTimers()
  autoSave()
  writer.mockRejectedValue(new Error('synthetic failure'))
  await expect(saveDocument('save-a', 'auto')).rejects.toThrow('synthetic')
  edit('C')
  await vi.advanceTimersByTimeAsync(100)
  await vi.advanceTimersByTimeAsync(100)
  await vi.advanceTimersByTimeAsync(1000)
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'C', 'C'])
  expect(useEditorStore.getState().tabs[0].modified).toBe(true)
  expect(toast.error).toHaveBeenCalledOnce()
  expect(scheduleMarkdownDocumentIndex).not.toHaveBeenCalled()
  await saveDocument('save-a', 'auto')
  expect(writer).toHaveBeenCalledTimes(3)
  writer.mockResolvedValue('written')
  expect(await saveDocument('save-a')).toMatchObject({ currentSaved: true })
})

it('手动失败及时拒绝并结算被替换等待者', async () => {
  const first = deferred()
  const second = deferred()
  writer.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise.then(() => { throw new Error('synthetic failure') }))
  const a = saveDocument('save-a')
  edit('B')
  const b = saveDocument('save-a')
  edit('C')
  const c = saveDocument('save-a')
  const settled = Promise.allSettled([b, c])
  first.resolve()
  await a
  second.resolve()
  expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected'])
})

it('关闭重开同一路径保持旧写入锁，迟到完成不清除新实例脏状态', async () => {
  const first = deferred()
  const second = deferred()
  writer.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const a = saveDocument('save-a')
  const old = useEditorStore.getState().tabs[0]
  useEditorStore.setState({ tabs: [] })
  useEditorStore.setState({ tabs: [{ ...old, content: 'new instance' }] })
  const b = saveDocument('save-a')
  expect(writer).toHaveBeenCalledTimes(1)
  first.resolve()
  await a
  expect(useEditorStore.getState().tabs[0].savedContent).toBe('')
  second.resolve()
  await b
  expect(useEditorStore.getState().tabs[0].savedContent).toBe('new instance')
})

it('Tab 路径变化取消未启动任务，不向新路径确认', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a')
  edit('B')
  const b = saveDocument('save-a')
  useEditorStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, filePath: 'X:/anon/renamed.md' })) }))
  expect(await b).toMatchObject({ status: 'cancelled' })
  first.resolve()
  await a
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'B', savedContent: '', modified: true })
  expect(writer).toHaveBeenCalledTimes(1)
})

it('关闭自动保存撤销待写任务，保留执行中写入确认', async () => {
  autoSave()
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a', 'auto')
  edit('B')
  const b = saveDocument('save-a', 'auto')
  autoSave(false)
  expect(await b).toMatchObject({ status: 'cancelled' })
  first.resolve()
  await a
  expect(writer).toHaveBeenCalledTimes(1)
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'B', savedContent: 'A', modified: true })
})

it('编辑后撤回 A 取消过时的 B 待写快照', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a')
  edit('B')
  const b = saveDocument('save-a')
  edit('A')
  first.resolve()
  await a
  expect(await b).toMatchObject({ status: 'cancelled' })
  expect(writer).toHaveBeenCalledTimes(1)
  expect(useEditorStore.getState().tabs[0].modified).toBe(false)
})

it('另存为选择器合并，选择结束读取最新正文，写入期间编辑保留', async () => {
  const selection = deferred()
  const first = deferred()
  useEditorStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, filePath: null })) }))
  picker.mockImplementation(() => selection.promise.then(() => ({ path: 'X:/anon/target.md', name: 'target.md' })))
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocumentAs('save-a')
  const duplicate = saveDocumentAs('save-a')
  expect(a).toBe(duplicate)
  edit('B')
  selection.resolve()
  await flush()
  expect(writer).toHaveBeenCalledWith('X:/anon/target.md', 'B')
  edit('C')
  first.resolve()
  await a
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ filePath: 'X:/anon/target.md', content: 'C', savedContent: 'B', modified: true })
  expect(picker).toHaveBeenCalledOnce()
})

it('另存为取消不写入、不绑定、不清脏；失效草稿也不写入', async () => {
  picker.mockResolvedValue(null)
  expect(await saveDocumentAs('save-a')).toBeNull()
  expect(writer).not.toHaveBeenCalled()
  const selection = deferred()
  picker.mockImplementation(() => selection.promise.then(() => ({ path: 'X:/anon/new.md', name: 'new.md' })))
  const a = saveDocumentAs('save-a')
  useEditorStore.setState({ tabs: [] })
  selection.resolve()
  expect(await a).toBeNull()
  expect(writer).not.toHaveBeenCalled()
})

it('下载回执不宣称原文件已落盘、不清脏、不调度索引', async () => {
  vi.useFakeTimers()
  autoSave()
  writer.mockResolvedValue('downloaded')
  const result = await saveDocument('save-a')
  expect(result).toMatchObject({ status: 'downloaded', currentSaved: false })
  expect(useEditorStore.getState().tabs[0].modified).toBe(true)
  expect(scheduleMarkdownDocumentIndex).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(writer).toHaveBeenCalledTimes(1)
})

it('Hook 卸载不释放执行中锁，手动待写继续结算', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const hook = renderHook(() => useFileOperations())
  let a!: Promise<void>
  act(() => { a = hook.result.current.handleSaveFile() })
  act(() => { edit('B') })
  const b = saveDocument('save-a')
  hook.unmount()
  expect(writer).toHaveBeenCalledTimes(1)
  first.resolve()
  await Promise.all([a, b])
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'B'])
})

it('另存为绑定后自动保存追上写入中的新编辑', async () => {
  autoSave()
  const first = deferred()
  useEditorStore.setState((state) => ({ tabs: state.tabs.map((tab) => ({ ...tab, filePath: null })) }))
  picker.mockResolvedValue({ path: 'X:/anon/target.md', name: 'target.md' })
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocumentAs('save-a')
  await flush()
  edit('latest')
  first.resolve()
  await a
  await flush()
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'latest'])
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'latest', savedContent: 'latest', modified: false })
})

it('索引仅包含 A/C 的成功写入快照，保持手动延迟', async () => {
  const first = deferred()
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a')
  edit('B')
  const b = saveDocument('save-a')
  edit('C')
  const c = saveDocument('save-a')
  first.resolve()
  await Promise.all([a, b, c])
  expect(vi.mocked(scheduleMarkdownDocumentIndex).mock.calls.map((call) => [call[2], call[3]])).toEqual([['A', 1200], ['C', 1200]])
})

it('文件菜单另存为同样经共享目标队列，并保留写入期间的新编辑', async () => {
  const first = deferred()
  picker.mockResolvedValue({ path: 'X:/anon/a.md', name: 'a.md' })
  writer.mockImplementationOnce(() => first.promise)
  const a = saveDocument('save-a')
  edit('B')
  const copy = saveTabAsFile(useEditorStore.getState().tabs[0])
  await flush()
  expect(writer).toHaveBeenCalledTimes(1)
  edit('C')
  first.resolve()
  await Promise.all([a, copy])
  expect(writer.mock.calls.map((call) => call[1])).toEqual(['A', 'B'])
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'C', savedContent: 'B', modified: true })
})

it('文件树另存为副本保持源 Tab 路径，并在选择结束读取最新正文', async () => {
  const selection = deferred()
  picker.mockImplementation(() => selection.promise.then(() => ({ path: 'X:/anon/copy.md', name: 'copy.md' })))
  const copy = saveExistingFileAs('X:/anon/a.md')
  edit('B')
  selection.resolve()
  await copy
  expect(writer).toHaveBeenCalledWith('X:/anon/copy.md', 'B')
  expect(useEditorStore.getState().tabs.find((tab) => tab.id === 'save-a')).toMatchObject({ filePath: 'X:/anon/a.md', content: 'B', savedContent: '' })
  expect(useEditorStore.getState().tabs.find((tab) => tab.filePath === 'X:/anon/copy.md')).toMatchObject({ content: 'B', savedContent: 'B' })
})
