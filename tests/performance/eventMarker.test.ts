import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PerfData } from '@/services/perfTypes'
import { eventMarker } from '@/services/eventMarker'

describe('performance events', () => {
  beforeEach(() => eventMarker.clearEvents())

  it('使用固定容量保存最近 500 条事件并清理隐私字段', () => {
    for (let index = 0; index < 501; index += 1) {
      eventMarker.mark('preview-render-complete', { index, filePath: 'C:\\private\\note.md' })
    }

    const events = eventMarker.exportEvents()
    expect(events).toHaveLength(500)
    expect(events[0].metadata).not.toHaveProperty('filePath')
  })

  it('完成事件使用操作后的新采样而不是复制 before', async () => {
    const before = { appPrivateWorkingSetKb: 10 } as PerfData
    const after = { appPrivateWorkingSetKb: 20 } as PerfData
    eventMarker.setSnapshotSource(() => before)
    eventMarker.setFreshSnapshotSource(vi.fn().mockResolvedValue(after))

    eventMarker.start('open-file-start')
    eventMarker.mark('open-file-complete')
    await Promise.resolve()

    const complete = eventMarker.exportEvents().at(-1)
    expect(complete?.before?.appPrivateWorkingSetKb).toBe(10)
    expect(complete?.after?.appPrivateWorkingSetKb).toBe(20)
  })

  it('点事件不伪造同一采样的内存增量', () => {
    const current = { appPrivateWorkingSetKb: 10 } as PerfData
    eventMarker.setSnapshotSource(() => current)

    eventMarker.mark('prewarm-create', { resource: 'left-preview', phase: 'requested' })

    const event = eventMarker.exportEvents().at(-1)
    expect(event?.before?.appPrivateWorkingSetKb).toBe(10)
    expect(event?.after).toBeUndefined()
  })
})
