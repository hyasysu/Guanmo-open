import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatBubble } from '@/components/ai/AiPanel'

describe('AI 回复保存入口', () => {
  it('只显示单一保存入口，菜单不包含范围标签或知识卡片', () => {
    const saveMarkdown = vi.fn()
    const saveArtifact = vi.fn()

    render(
      <ChatBubble
        role="assistant"
        content="匿名回复正文"
        isLast={false}
        streaming={false}
        onSaveAsMarkdown={saveMarkdown}
        onSaveAsArtifact={saveArtifact}
      />,
    )

    const saveButton = screen.getByRole('button', { name: '保存回复' })
    expect(saveButton).toBeInTheDocument()
    expect(saveButton).toHaveClass('!h-6', '!w-6', '!rounded-full')
    expect(saveButton.parentElement).toHaveClass('bottom-0', 'left-full')
    expect(saveButton.parentElement?.previousElementSibling).toContainElement(screen.getByText('匿名回复正文'))
    expect(screen.queryByText('选区')).not.toBeInTheDocument()
    expect(screen.queryByText('Markdown')).not.toBeInTheDocument()

    fireEvent.click(saveButton)

    expect(screen.getByText('Markdown')).toBeInTheDocument()
    expect(screen.getByText('摘要')).toBeInTheDocument()
    expect(screen.getByText('问题集')).toBeInTheDocument()
    expect(screen.getByText('阅读笔记')).toBeInTheDocument()
    expect(screen.queryByText('卡片')).not.toBeInTheDocument()
    expect(screen.queryByText('批注')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('摘要'))
    expect(saveArtifact).toHaveBeenCalledWith('summary')
    expect(screen.queryByText('Markdown')).not.toBeInTheDocument()
  })
})
