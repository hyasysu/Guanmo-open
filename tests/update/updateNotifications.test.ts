import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toastShow: vi.fn(),
  showWindowsNotification: vi.fn(async () => undefined),
  recordNotifiedVersion: vi.fn(),
}))

vi.mock('@/services/toast', () => ({
  toast: { show: mocks.toastShow },
}))

vi.mock('@/services/readingReminderNotifications', () => ({
  showWindowsNotification: mocks.showWindowsNotification,
}))

vi.mock('@/services/updateService', () => ({
  checkForUpdates: vi.fn(),
  ignoreUpdateVersion: vi.fn(),
  recordNotifiedVersion: mocks.recordNotifiedVersion,
}))

vi.mock('@/stores/updateStore', () => ({
  useUpdateStore: { getState: () => ({ showDetails: vi.fn() }) },
}))

import { showAvailableUpdate } from '@/services/updateNotifications'

const update = {
  currentVersion: '1.0.0',
  latestVersion: '1.1.0',
  release: {
    tag_name: 'v1.1.0',
    name: '1.1.0',
    body: null,
    published_at: '2026-08-13T00:00:00Z',
    html_url: 'https://example.invalid/release',
    draft: false,
    prerelease: false,
  },
}

describe('update notifications', () => {
  beforeEach(() => {
    mocks.toastShow.mockReset()
    mocks.showWindowsNotification.mockReset().mockResolvedValue(undefined)
    mocks.recordNotifiedVersion.mockReset()
  })

  it('shows the software toast and Windows notification once per version', async () => {
    expect(showAvailableUpdate(update)).toBe(true)
    expect(showAvailableUpdate(update)).toBe(false)
    expect(mocks.toastShow).toHaveBeenCalledTimes(1)
    expect(mocks.showWindowsNotification).toHaveBeenCalledWith({
      title: '发现新版本',
      body: '观墨 v1.1.0 已发布',
    })
  })

  it('keeps the software toast when the Windows notification fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.showWindowsNotification.mockRejectedValueOnce(new Error('notification_show_failed'))
    expect(showAvailableUpdate({ ...update, latestVersion: '1.2.0' })).toBe(true)
    await Promise.resolve()
    expect(mocks.toastShow).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[Update] Windows notification unavailable')
  })
})
