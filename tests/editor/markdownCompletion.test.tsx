import { render, fireEvent, act } from '@testing-library/react'
import { CompletionContext, currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { type EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { describe, expect, it, vi } from 'vitest'
import { markdownCompletionSource } from '@/services/markdownCompletion'
import { CodeMirrorEditor } from '@/components/editor/CodeMirrorEditor'
import { createMarkdownPreviewModel } from '@/services/markdownPreviewModel'

vi.mock('@/services/eventMarker', () => ({ eventMarker: { mark: vi.fn() } }))
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()

async function complete(doc: string, pos = doc.length, explicit = false) {
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown({ base: markdownLanguage })] })
  return markdownCompletionSource(new CompletionContext(state, pos, explicit))
}

describe('Markdown 写作补全', () => {
  it('所有候选位于同一个滚动列表，不依赖方向键翻页', async () => {
    const viewRef = { current: null as EditorView | null }
    const { rerender } = render(<CodeMirrorEditor content="/" documentKey="scroll-templates" viewRef={viewRef} onChange={vi.fn()} />)
    const open = () => {
      const view = viewRef.current!
      act(() => {
        view.dispatch({ selection: { anchor: view.state.doc.length } })
        view.focus()
        startCompletion(view)
      })
      return view
    }
    let view = open()
    await vi.waitFor(() => expect(currentCompletions(view.state)).toHaveLength(9))
    expect(view.dom.querySelectorAll('.cm-tooltip-autocomplete li')).toHaveLength(9)
    expect(view.dom.querySelector('.cm-completionListIncompleteBottom')).toBeNull()

    const doc = Array.from({ length: 125 }, (_, index) => `# 标题${index}`).join('\n\n') + '\n\n[跳转](#'
    rerender(<CodeMirrorEditor content={doc} documentKey="scroll-headings" viewRef={viewRef} onChange={vi.fn()} />)
    view = open()
    await vi.waitFor(() => expect(currentCompletions(view.state)).toHaveLength(125))
    expect(view.dom.querySelectorAll('.cm-tooltip-autocomplete li')).toHaveLength(125)
    expect(view.dom.querySelector('.cm-completionListIncompleteBottom')).toBeNull()
  })

  it('行首触发模板，支持英文及中文筛选，正文和路径保持安静', async () => {
    expect((await complete('/table'))?.options.map((item) => item.label)).toEqual(['/table'])
    expect((await complete('/file'))?.options.map((item) => item.label)).toEqual(['/file'])
    expect((await complete('/文件'))?.options.map((item) => item.label)).toEqual(['/file'])
    expect((await complete('/表'))?.options.map((item) => item.label)).toEqual(['/table', '/task', '/list'])
    expect((await complete(''))?.options).toBeUndefined()
    expect((await complete('', 0, true))?.options).toHaveLength(9)
    for (const text of ['普通中文', '正文 /table', 'https://example.com/', '/usr/local', '    /table', '`/table`']) {
      expect(await complete(text)).toBeNull()
    }
  })

  it('只在代码围栏首行补全语言，不在正文或闭合围栏弹出', async () => {
    expect((await complete('```js'))?.options.find((item) => item.detail === 'JavaScript')?.label).toBe('js')
    expect((await complete('```py'))?.options.some((item) => item.label === 'python')).toBe(true)
    expect((await complete('~~~ts'))?.options.some((item) => item.label === 'ts')).toBe(true)
    expect(await complete('```md\n/table')).toBeNull()
    expect(await complete('```md\nbody\n```')).toBeNull()
    expect(await complete('`inline /table', 14)).toBeNull()
  })

  it('标题链接与预览锚点一致，包含重复、格式化和 Setext 标题，排除代码', async () => {
    const doc = '# 中文标题\n\n# **格式** [链接](https://example.com) `代码`\n\n# 中文标题\n\nSetext\n---\n\n# A &amp; B\n\n```md\n# 假标题\n```\n\n[跳转](#'
    const result = await complete(doc)
    const headings = createMarkdownPreviewModel(doc).toc
    expect(result?.options.map((item) => item.label)).toEqual(headings.map((item) => `#${item.id}`))
    expect(result?.options).toHaveLength(5)
    const closedLink = '# A\n[跳转](#a)'
    expect((await complete(closedLink, closedLink.length - 1))?.options).toBeDefined()
    expect(await complete('# A\n```md\n[跳转](#')).toBeNull()
  })

  it('不对非空选区或多个光标提供候选', () => {
    const state = EditorState.create({ doc: '/table', selection: { anchor: 0, head: 6 } })
    expect(markdownCompletionSource(new CompletionContext(state, 6, true))).toBeNull()
  })

  it.each([
    ['/table', '| 列一 | 列二 |', '列一', '列二'],
    ['/file', '[文字](./文件.md)', '文字', '文件.md'],
  ])('真实编辑器接受 %s 后沿原链路更新，一次撤销，并在切换文件后使用新标题', async (command, inserted, firstField, secondField) => {
    const viewRef = { current: null as EditorView | null }
    const onChange = vi.fn()
    const { rerender } = render(<CodeMirrorEditor content="" documentKey="A" viewRef={viewRef} onChange={onChange} />)
    const view = viewRef.current!
    act(() => {
      view.focus()
      view.dispatch({ changes: { from: 0, insert: command }, selection: { anchor: command.length }, userEvent: 'input.type' })
    })
    await vi.waitFor(() => expect(currentCompletions(view.state).some((item) => item.label === command)).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 100))
    fireEvent.keyDown(view.contentDOM, { key: 'Enter', code: 'Enter' })
    expect(view.state.doc.toString()).toContain(inserted)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(firstField)
    fireEvent.keyDown(view.contentDOM, { key: 'Tab', code: 'Tab' })
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(secondField)
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(view.state.doc.toString()))
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe(command)
    rerender(<CodeMirrorEditor content={'# 新标题\n[跳转](#'} documentKey="B" viewRef={viewRef} onChange={onChange} />)
    const nextView = viewRef.current!
    act(() => {
      nextView.dispatch({ selection: { anchor: nextView.state.doc.length } })
      nextView.focus()
      startCompletion(nextView)
    })
    await vi.waitFor(() => expect(currentCompletions(nextView.state).map((item) => item.label)).toEqual(['#新标题']))
    fireEvent.keyDown(nextView.contentDOM, { key: 'Escape', code: 'Escape' })
    expect(nextView.state.doc.toString()).toBe('# 新标题\n[跳转](#')
  })

  it('普通 Tab 保持缩进，Markdown 原有 HTML 补全仍然可用', async () => {
    const viewRef = { current: null as EditorView | null }
    const { rerender } = render(<CodeMirrorEditor content="text" documentKey="C" viewRef={viewRef} onChange={vi.fn()} />)
    const view = viewRef.current!
    fireEvent.keyDown(view.contentDOM, { key: 'Tab', code: 'Tab' })
    expect(view.state.doc.toString()).toMatch(/^ +text$/)
    rerender(<CodeMirrorEditor content="<di" documentKey="D" viewRef={viewRef} onChange={vi.fn()} />)
    const htmlView = viewRef.current!
    act(() => {
      htmlView.dispatch({ selection: { anchor: htmlView.state.doc.length } })
      htmlView.focus()
      startCompletion(htmlView)
    })
    await vi.waitFor(() => expect(currentCompletions(htmlView.state).some((item) => item.label === '<div')).toBe(true))
  })

  it('输入法开始组词时关闭候选菜单，不插入模板', async () => {
    const viewRef = { current: null as EditorView | null }
    render(<CodeMirrorEditor content="/table" documentKey="IME" viewRef={viewRef} onChange={vi.fn()} />)
    const view = viewRef.current!
    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      view.focus()
      startCompletion(view)
    })
    await vi.waitFor(() => expect(currentCompletions(view.state)).not.toHaveLength(0))
    fireEvent.compositionStart(view.contentDOM)
    expect(currentCompletions(view.state)).toHaveLength(0)
    expect(view.state.doc.toString()).toBe('/table')
    fireEvent.compositionEnd(view.contentDOM)
  })
})
