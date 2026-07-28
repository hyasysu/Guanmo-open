import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

describe('MarkdownPreview 内嵌 HTML', () => {
  it('渲染 GitHub README 常见的 HTML 混排', async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          '<p align="center"><img src="logo.png" alt="项目 Logo" width="120"></p>',
          '',
          '<details open><summary>更多信息</summary><div>说明<br>第二行</div></details>',
          '',
          '<table><thead><tr><th>名称</th></tr></thead><tbody><tr><td>GuanMo</td></tr></tbody></table>',
          '',
          '<blockquote>引用 <span>内容</span></blockquote>',
          '',
          'H<sub>2</sub>O X<sup>2</sup> <kbd>Ctrl</kbd>',
          '',
          '现有公式 $x^2$',
        ].join('\n')}
      />,
    )

    await waitFor(() => expect(container.querySelector('details')).toBeInTheDocument())
    const centeredParagraph = container.querySelector('p[align="center"]')
    expect(centeredParagraph).not.toBeNull()
    expect(screen.getByRole('img', { name: '项目 Logo' })).toHaveAttribute('width', '120')
    expect(container.querySelector('details[open] summary')).toHaveTextContent('更多信息')
    expect(container.querySelector('details br')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'GuanMo' })).toBeInTheDocument()
    expect(container.querySelector('blockquote span')).toHaveTextContent('内容')
    expect(container.querySelector('sub')).toHaveTextContent('2')
    expect(container.querySelector('sup')).toHaveTextContent('2')
    expect(container.querySelector('kbd')).toHaveTextContent('Ctrl')
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('移除危险标签、事件属性、样式和危险 URL', async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          '<script>globalThis.__htmlAttack = true</script>',
          '<iframe src="https://example.com"></iframe>',
          '<object data="https://example.com"></object>',
          '<embed src="https://example.com">',
          '<img src="safe.png" alt="安全图片" onerror="globalThis.__htmlAttack = true" style="position:fixed">',
          '<span onclick="globalThis.__htmlAttack = true" class="hostile">安全文本</span>',
          '<a href="javascript:globalThis.__htmlAttack = true">危险链接</a>',
        ].join('\n')}
      />,
    )

    await screen.findByText('安全文本')
    expect(container.querySelector('script, iframe, object, embed')).toBeNull()
    expect(container.querySelector('[onerror], [onclick], .hostile')).toBeNull()
    const safeImage = screen.getByRole('img', { name: '安全图片' })
    expect(safeImage).toHaveAttribute('src', 'safe.png')
    expect(safeImage).not.toHaveAttribute('style')
    expect(screen.getByText('安全文本')).not.toHaveAttribute('style')
    expect(screen.getByText('危险链接').closest('a')).not.toHaveAttribute('href')
    expect((globalThis as typeof globalThis & { __htmlAttack?: boolean }).__htmlAttack).toBeUndefined()
  })

  it('skipHtml 仍可完全禁用内嵌 HTML', () => {
    const { container } = render(
      <MarkdownPreview content="<details><summary>隐藏内容</summary></details>" skipHtml />,
    )

    expect(container.querySelector('details')).toBeNull()
    expect(screen.queryByText('隐藏内容')).not.toBeInTheDocument()
  })
})
