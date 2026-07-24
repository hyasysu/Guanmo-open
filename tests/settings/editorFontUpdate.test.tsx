import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeMirrorEditor } from '@/components/editor/CodeMirrorEditor'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/services/editorCodeLanguages', () => ({
  editorCodeLanguages: [],
}))

describe('编辑器字体设置', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState((state) => ({
      ...state,
      editor: {
        ...state.editor,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      },
    }))
  })

  it('字体栈变更后会更新 CodeMirror 内容区域样式', async () => {
    const { container } = render(
      <div style={{ height: 320 }}>
        <CodeMirrorEditor content={'# hello'} onChange={() => undefined} />
      </div>
    )

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeTruthy()
    })

    useSettingsStore.getState().updateEditorSettings({
      fontFamily: "'Fira Code', 'Cascadia Code', monospace",
    })

    await waitFor(() => {
      const content = container.querySelector('.cm-content') as HTMLElement | null
      expect(content).toBeTruthy()
      expect(content?.style.fontFamily).toContain('Fira Code')
    })

    await waitFor(() => {
      const gutters = container.querySelector('.cm-gutters') as HTMLElement | null
      expect(gutters).toBeTruthy()
      expect(window.getComputedStyle(gutters as HTMLElement).fontFamily).toContain('Fira Code')
    })
  })

  it('编辑器字体会在通用 monospace 回退前拼接预览字体栈', async () => {
    useSettingsStore.getState().updateEditorSettings({
      fontFamily: "'JetBrains Mono', monospace",
      previewFontFamily: 'var(--gm-font-family)',
    })

    const { container } = render(
      <div style={{ height: 320 }}>
        <CodeMirrorEditor content={'中文 English'} onChange={() => undefined} />
      </div>
    )

    await waitFor(() => {
      const content = container.querySelector('.cm-content') as HTMLElement | null
      expect(content).toBeTruthy()
      expect(content?.style.fontFamily).toContain('JetBrains Mono')
      expect(content?.style.fontFamily).toContain('var(--gm-font-family)')
      expect(content?.style.fontFamily.indexOf('var(--gm-font-family)')).toBeLessThan(content?.style.fontFamily.indexOf('monospace') ?? -1)
    })
  })
})
