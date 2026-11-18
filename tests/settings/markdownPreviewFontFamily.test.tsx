import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { parse } from 'postcss'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

const CUSTOM_PREVIEW_FONT = "'Custom Preview Font', serif"
const globalStyles = parse(readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8'))

function githubFontDeclarations(element: Element): string[] {
  const values: string[] = []
  globalStyles.walkRules((rule) => {
    if (rule.selector.includes("[data-light-palette='github-dmmono']") && element.matches(rule.selector)) {
      rule.walkDecls('font-family', ({ value }) => { values.push(value) })
    }
  })
  return values
}

describe('Markdown 预览字体', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.lightPalette
  })

  it('GitHub 调色板保留用户设置的预览字体栈', () => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.dataset.lightPalette = 'github-dmmono'

    const { container } = render(
      <MarkdownPreview content={'# 标题\n\n正文中的 `代码`'} fontFamily={CUSTOM_PREVIEW_FONT} />,
    )
    const preview = container.querySelector('.gm-markdown-preview') as HTMLElement
    const inlineCode = preview.querySelector('p code')!

    expect(preview.style.fontFamily).toContain('Custom Preview Font')
    expect(inlineCode).toBeInTheDocument()
    expect(githubFontDeclarations(preview)).toEqual(['inherit'])
    expect(githubFontDeclarations(inlineCode)).toEqual(['inherit'])
  })
})
