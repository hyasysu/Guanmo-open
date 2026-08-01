import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchOverlay } from '@/components/editor/SearchOverlay'

describe('SearchOverlay 预览全文搜索', () => {
  it('统计未挂载内容并按匹配 offset 请求虚拟预览定位', () => {
    const paneRef = createRef<HTMLDivElement>()
    const scrollToOffset = vi.fn()
    const previewRef = { current: { scrollToOffset } }
    const content = '首屏内容\n\n隐藏目标\n\n再次出现隐藏目标'

    render(
      <>
        <div ref={paneRef}>首屏内容</div>
        <SearchOverlay
          onClose={vi.fn()}
          previewSources={[{ content, paneRef, previewRef }]}
        />
      </>,
    )

    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '隐藏目标' } })

    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(scrollToOffset).toHaveBeenLastCalledWith(content.indexOf('隐藏目标'))

    fireEvent.click(screen.getByTitle('下一个 (Enter)'))

    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(scrollToOffset).toHaveBeenLastCalledWith(content.lastIndexOf('隐藏目标'))
  })
})
