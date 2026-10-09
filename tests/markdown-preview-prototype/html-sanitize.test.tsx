import { render, screen } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'
import { MARKDOWN_HTML_REHYPE_PLUGINS } from '@/services/markdownHtml'

describe('Markdown HTML sanitization', () => {
  it('真实预览移除脚本、事件属性、危险链接及嵌入页面，保留安全内容', async () => {
    const { container } = render(<MarkdownPreview content={`
<script>window.__attack=1</script>
<iframe srcdoc="<script>window.__attack=1</script>"></iframe>
<object data="javascript:window.__attack=1"></object>
<img src="https://example.test/safe.png" alt="safe attack fixture" onerror="window.__attack=1" />
<a href="javascript:window.__attack=1" onclick="window.__attack=1">unsafe link</a>
<p>safe paragraph</p>
`} />)
    await screen.findByText('safe paragraph')
    expect(container.querySelector('script, iframe, object, embed')).toBeNull()
    expect(container.innerHTML).not.toMatch(/onerror=|onclick=|href="javascript:/i)
    expect(screen.getByAltText('safe attack fixture')).toBeInTheDocument()
  })

  it('preserves supported paragraph alignment for GitHub-style README badges', () => {
    render(
      <ReactMarkdown rehypePlugins={MARKDOWN_HTML_REHYPE_PLUGINS}>
        {'<p align="center"><img src="https://example.test/badge.svg" alt="Badge" /></p>'}
      </ReactMarkdown>,
    )

    const paragraph = screen.getByRole('paragraph')
    expect(paragraph).toHaveAttribute('align', 'center')
    expect(screen.getByAltText('Badge')).toBeInTheDocument()
  })

  it('preserves paragraph alignment as a presentation-only attribute', () => {
    render(
      <ReactMarkdown rehypePlugins={MARKDOWN_HTML_REHYPE_PLUGINS}>
        {'<p align="marquee">content</p>'}
      </ReactMarkdown>,
    )

    expect(screen.getByRole('paragraph')).toHaveAttribute('align', 'marquee')
  })

  it('marks centered README badge paragraphs for inline badge layout', async () => {
    render(
      <MarkdownPreview
        content={'<p align="center"><img src="https://example.test/one.svg" alt="One" /> <img src="https://example.test/two.svg" alt="Two" /></p>'}
      />,
    )

    const firstBadge = await screen.findByAltText('One')
    const paragraph = firstBadge.closest('p')
    expect(paragraph).toHaveClass('gm-markdown-paragraph--align-center')
    expect(firstBadge.closest('button')).toHaveClass('gm-markdown-image')
    expect(screen.getByAltText('Two').closest('button')).toHaveClass('gm-markdown-image')
  })

  it('keeps formatted README badge lines in the same centered paragraph', async () => {
    render(
      <MarkdownPreview
        content={`<p align="center">
  <img src="https://example.test/one.svg" alt="One" />
  <img src="https://example.test/two.svg" alt="Two" />
</p>`}
      />,
    )

    const firstButton = (await screen.findByAltText('One')).closest('button')
    const secondButton = screen.getByAltText('Two').closest('button')
    expect(firstButton?.parentElement).toBe(secondButton?.parentElement)
    expect(firstButton?.parentElement).toHaveClass('gm-markdown-paragraph--align-center')
  })
})
