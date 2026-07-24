import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileTree } from '@/components/file-tree/FileTree'
import type { FileNode } from '@/services/fileTree'

const nodes: FileNode[] = [
  {
    name: 'docs',
    path: '/docs',
    type: 'directory',
    children: [
      {
        name: 'guide',
        path: '/docs/guide',
        type: 'directory',
        children: [
          {
            name: 'intro.md',
            path: '/docs/guide/intro.md',
            type: 'file',
            extension: 'md',
          },
        ],
      },
    ],
  },
]

describe('FileTree collapse all', () => {
  it('collapseAllSignal 折叠已展开的文件夹内容', () => {
    const { rerender } = render(<FileTree nodes={nodes} collapseAllSignal={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'guide' }))
    expect(screen.getByText('intro.md')).toBeInTheDocument()

    rerender(<FileTree nodes={nodes} collapseAllSignal={1} />)
    expect(screen.queryByText('intro.md')).not.toBeInTheDocument()
  })

  it('expandAllSignal 展开所有文件夹内容', () => {
    const { rerender } = render(<FileTree nodes={nodes} collapseAllSignal={0} expandAllSignal={0} />)

    rerender(<FileTree nodes={nodes} collapseAllSignal={1} expandAllSignal={0} />)
    expect(screen.queryByText('intro.md')).not.toBeInTheDocument()

    rerender(<FileTree nodes={nodes} collapseAllSignal={1} expandAllSignal={1} />)
    expect(screen.getByText('intro.md')).toBeInTheDocument()
  })
})
