import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'
import { useSettingsStore } from '@/stores/settingsStore'

const CUSTOM_PREVIEW_FONT = "'Custom Preview Font', serif"
const globalStyles = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

describe('Markdown 预览字体', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.lightPalette
    useSettingsStore.getState().updateEditorSettings({ previewFontFamily: 'var(--gm-font-family)' })
  })

  it('GitHub 调色板保留用户设置的预览字体栈', () => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.dataset.lightPalette = 'github-dmmono'
    useSettingsStore.getState().updateEditorSettings({ previewFontFamily: CUSTOM_PREVIEW_FONT })

    const { container } = render(<MarkdownPreview content={'# 标题\n\n正文中的 `代码`'} />)
    const preview = container.querySelector('.gm-markdown-preview') as HTMLElement
    const githubPreviewStyles = globalStyles.slice(
      globalStyles.indexOf(":root[data-light-palette='github-dmmono']:not([data-theme='dark']) .gm-markdown-preview {"),
      globalStyles.indexOf('.gm-code-block {'),
    )

    expect(preview.style.fontFamily).toContain('Custom Preview Font')
    expect(githubPreviewStyles).toMatch(/\.gm-markdown-preview \{[\s\S]*?font-family: inherit;/)
    expect(githubPreviewStyles).toMatch(/\.gm-markdown-preview p code \{[\s\S]*?font-family: inherit;/)
    expect(githubPreviewStyles).not.toContain('DMMono Nerd Font')
  })
})
