import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ChatMessageSource } from '@/services/ai/types'

const { addTabMock } = vi.hoisted(() => ({ addTabMock: vi.fn() }))

vi.mock('@/services/fileSystem', () => ({
  saveFileAs: vi.fn(),
}))
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ addTab: addTabMock }),
  },
}))
vi.mock('@/services/rag/indexer', () => ({
  scheduleMarkdownDocumentIndex: vi.fn(),
}))
vi.mock('@/services/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  },
}))

import { saveFileAs } from '@/services/fileSystem'
import { scheduleMarkdownDocumentIndex } from '@/services/rag/indexer'
import { toast } from '@/services/toast'
import {
  buildAssistantMessageMarkdown,
  saveAssistantMessageAsMarkdown,
} from '@/services/assistantMessageExport'

const localSource: ChatMessageSource = {
  kind: 'local',
  filePath: 'C:\\Temp\\anonymous-note.md',
  fileName: 'anonymous-note.md',
  titlePath: ['匿名章节'],
  startLine: 2,
  endLine: 4,
}

const webSource: ChatMessageSource = {
  kind: 'web',
  title: '匿名网页',
  url: 'https://example.com/anonymous',
  siteName: 'Example',
  publishedAt: '2026-08-08',
}

describe('buildAssistantMessageMarkdown', () => {
  it('包含标题与正文，无来源时不输出来源区块', () => {
    const md = buildAssistantMessageMarkdown({ content: '这是匿名正文。' })
    expect(md).toContain('# AI 阅读回复')
    expect(md).toContain('这是匿名正文。')
    expect(md).not.toContain('ai_question:')
    expect(md).not.toContain('## 来源')
    expect(md).not.toContain('---')
  })

  it('把多行用户提问写入 YAML Frontmatter，分隔符仍保持缩进', () => {
    const md = buildAssistantMessageMarkdown({
      content: '匿名回答',
      question: '请对比两个方案\r\n---\r\n并说明理由',
    })
    expect(md).toMatch(/^---\nai_question: \|-\n[ ]{2}请对比两个方案\n[ ]{2}---\n[ ]{2}并说明理由\n---\n\n# AI 阅读回复/)
    expect(md).toContain('\n\n匿名回答\n')
  })

  it('本地来源只写文件名、标题路径与行号，不写绝对路径', () => {
    const md = buildAssistantMessageMarkdown({ content: '正文', sources: [localSource] })
    expect(md).toContain('anonymous-note.md')
    expect(md).toContain('匿名章节')
    expect(md).toContain('L2-4')
    // 绝对路径不得写入正文
    expect(md).not.toContain('C:\\Temp')
    expect(md).not.toContain('C:\\\\Temp')
  })

  it('Web 来源写为标题链接与站点/日期', () => {
    const md = buildAssistantMessageMarkdown({ content: '正文', sources: [webSource] })
    expect(md).toContain('[匿名网页](https://example.com/anonymous)')
    expect(md).toContain('Example')
    expect(md).toContain('2026-08-08')
  })

  it('提供时间戳时输出生成日期', () => {
    // 本地时间 2026-08-08，与运行时区无关（getFullYear/Month/Date 使用本地分量）
    const ts = new Date(2026, 7, 8, 10, 0, 0).getTime()
    const md = buildAssistantMessageMarkdown({ content: '正文', timestamp: ts })
    expect(md).toContain('生成于 2026-08-08')
  })
})

describe('saveAssistantMessageAsMarkdown', () => {
  beforeEach(() => {
    vi.mocked(saveFileAs).mockReset()
    vi.mocked(scheduleMarkdownDocumentIndex).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    addTabMock.mockReset()
  })

  it('保存成功后开新标签并调度 RAG 索引', async () => {
    vi.mocked(saveFileAs).mockResolvedValue({
      path: 'C:\\Temp\\anonymous-note.md',
      name: 'anonymous-note.md',
      content: '# AI 阅读回复\n\n正文',
    })

    const result = await saveAssistantMessageAsMarkdown('正文', [localSource], '对应的匿名问题')

    expect(result.saved).toBe(true)
    expect(saveFileAs).toHaveBeenCalledOnce()
    // 写入内容包含正文与来源，但不包含绝对路径
    const written = vi.mocked(saveFileAs).mock.calls[0][0]
    expect(written).toContain('正文')
    expect(written).toContain('ai_question: |-\n  对应的匿名问题')
    expect(written).toContain('anonymous-note.md')
    expect(written).not.toContain('C:\\Temp')
    expect(addTabMock).toHaveBeenCalledWith(
      'C:\\Temp\\anonymous-note.md',
      'anonymous-note.md',
      expect.stringContaining('# AI 阅读回复'),
    )
    expect(scheduleMarkdownDocumentIndex).toHaveBeenCalledWith(
      'C:\\Temp\\anonymous-note.md',
      'anonymous-note.md',
      expect.any(String),
    )
    expect(toast.success).toHaveBeenCalledWith('已保存为 anonymous-note.md')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('用户取消时不留半成品标签页、不调度索引', async () => {
    vi.mocked(saveFileAs).mockResolvedValue(null)

    const result = await saveAssistantMessageAsMarkdown('正文', [localSource])

    expect(result.saved).toBe(false)
    expect(addTabMock).not.toHaveBeenCalled()
    expect(scheduleMarkdownDocumentIndex).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('写入失败时提示错误且不开标签、不调度索引', async () => {
    vi.mocked(saveFileAs).mockRejectedValue(new Error('磁盘已满'))

    const result = await saveAssistantMessageAsMarkdown('正文', [localSource])

    expect(result.saved).toBe(false)
    expect(addTabMock).not.toHaveBeenCalled()
    expect(scheduleMarkdownDocumentIndex).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('保存失败'))
  })
})
