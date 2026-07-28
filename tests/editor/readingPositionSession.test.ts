import { describe, expect, it } from 'vitest'

import { ReadingPositionSession } from '@/services/editorSession'

describe('ReadingPositionSession', () => {
  it('跨编辑和预览模式时只保留最近模式的精确滚动位置', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', { previewScrollTop: 320, topLine: 24 })
    session.save('tab-1', { editorScrollTop: 960, topLine: 80 })

    expect(session.get('tab-1')).toMatchObject({
      editorScrollTop: 960,
      previewScrollTop: undefined,
      topLine: 80,
    })

    session.save('tab-1', { previewScrollTop: 1440, topLine: 120 })

    expect(session.get('tab-1')).toMatchObject({
      editorScrollTop: undefined,
      previewScrollTop: 1440,
      topLine: 120,
    })
  })

  it('载入旧版冲突位置时回退到共享行号', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', {
      editorScrollTop: 960,
      previewScrollTop: 1440,
      topLine: 120,
    })

    expect(session.get('tab-1')).toMatchObject({
      editorScrollTop: undefined,
      previewScrollTop: undefined,
      topLine: 120,
    })
  })
})
