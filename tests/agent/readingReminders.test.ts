import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingReminder } from '@/services/database/readingReminders'
import type { ReadingReminderNotificationAdapter } from '@/services/readingReminderNotifications'

const repository = vi.hoisted(() => ({
  reminders: new Map<string, ReadingReminder>(),
}))
const notificationRuntime = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined as unknown),
  toastShow: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: notificationRuntime.invoke,
  isTauri: () => true,
}))

vi.mock('@/services/toast', () => ({
  toast: { show: notificationRuntime.toastShow },
}))

vi.mock('@/services/database/readingReminders', () => ({
  loadReadingReminderById: vi.fn(async (id: string) => repository.reminders.get(id)),
  loadReadingReminders: vi.fn(async () => [...repository.reminders.values()]),
  persistReadingReminder: vi.fn(async (input: Omit<ReadingReminder, 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    repository.reminders.set(input.id, {
      description: null,
      sourceArtifactId: null,
      sourceFilePath: null,
      sourceMessageId: null,
      notificationId: null,
      errorCode: null,
      ...input,
      createdAt: now,
      updatedAt: now,
    })
  }),
  updateReadingReminderState: vi.fn(async (
    id: string,
    status: ReadingReminder['status'],
    options: { notificationId?: number | null; errorCode?: string | null } = {},
  ) => {
    const current = repository.reminders.get(id)
    if (!current) return
    repository.reminders.set(id, {
      ...current,
      status,
      ...(Object.prototype.hasOwnProperty.call(options, 'notificationId')
        ? { notificationId: options.notificationId ?? null }
        : {}),
      errorCode: options.errorCode ?? null,
      updatedAt: Date.now(),
    })
  }),
}))

import {
  notificationIdForReminder,
  readingReminderNotificationAdapter,
} from '@/services/readingReminderNotifications'
import {
  cancelReadingReminder,
  createReadingReminder,
  editReadingReminderTime,
  reconcileReadingReminders,
  retryReadingReminder,
} from '@/services/readingReminders'
import { processDueReadingReminders } from '@/services/readingReminderRuntime'

function reminder(overrides: Partial<ReadingReminder> = {}): ReadingReminder {
  const now = Date.now()
  return {
    id: 'reminder-1',
    title: '复习章节',
    description: '回顾重点',
    dueAtUtc: now + 60_000,
    createdTimezone: 'Asia/Shanghai',
    status: 'scheduled',
    sourceArtifactId: null,
    sourceFilePath: null,
    sourceMessageId: null,
    notificationId: 42,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function adapter(overrides: Partial<ReadingReminderNotificationAdapter> = {}): ReadingReminderNotificationAdapter {
  return {
    ensurePermission: vi.fn(async () => true),
    schedule: vi.fn(async () => undefined),
    pendingIds: vi.fn(async () => new Set<number>()),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('reading reminder lifecycle', () => {
  beforeEach(() => {
    repository.reminders.clear()
    notificationRuntime.invoke.mockReset().mockResolvedValue(undefined)
    notificationRuntime.toastShow.mockReset()
  })

  it('uses the restricted native commands and a nonempty default body', async () => {
    const dueAtUtc = Date.now() + 60_000
    await readingReminderNotificationAdapter.schedule({ id: 11, title: '复习', dueAtUtc })
    expect(notificationRuntime.invoke).toHaveBeenCalledWith('schedule_reading_reminder_notification', {
      input: { id: 11, title: '复习', body: '该回到观墨继续阅读了。', dueAtUtc },
    })

    notificationRuntime.invoke.mockResolvedValueOnce([11, -1, 0, 12.5, 13])
    await expect(readingReminderNotificationAdapter.pendingIds()).resolves.toEqual(new Set([11, 13]))

    await readingReminderNotificationAdapter.cancel(11)
    expect(notificationRuntime.invoke).toHaveBeenLastCalledWith(
      'cancel_reading_reminder_notification',
      { id: 11 },
    )
  })

  it('uses the native Windows registration status as permission state', async () => {
    notificationRuntime.invoke.mockResolvedValueOnce({
      supported: true,
      registered: true,
      errorCode: null,
    })
    await expect(readingReminderNotificationAdapter.ensurePermission(true)).resolves.toBe(true)
    expect(notificationRuntime.invoke).toHaveBeenCalledWith('get_windows_notification_status')
  })

  it('derives a stable positive 32-bit notification id', () => {
    const id = notificationIdForReminder('reminder-action-1')
    expect(id).toBe(notificationIdForReminder('reminder-action-1'))
    expect(id).toBeGreaterThan(0)
    expect(id).toBeLessThanOrEqual(0x7fffffff)
  })

  it('persists pending before scheduling and finishes scheduled', async () => {
    const notifications = adapter()
    const dueAtUtc = Date.now() + 60_000
    const created = await createReadingReminder({
      id: 'reminder-create',
      title: '复习章节',
      dueAtUtc,
      createdTimezone: 'Asia/Shanghai',
    }, notifications)
    expect(notifications.ensurePermission).toHaveBeenCalledWith(true)
    expect(notifications.schedule).toHaveBeenCalledWith(expect.objectContaining({ dueAtUtc }))
    expect(created.status).toBe('scheduled')
    expect(created.errorCode).toBeNull()
  })

  it('keeps an anonymous failure state when permission is denied', async () => {
    const notifications = adapter({ ensurePermission: vi.fn(async () => false) })
    await expect(createReadingReminder({
      id: 'reminder-denied',
      title: '复习章节',
      dueAtUtc: Date.now() + 60_000,
      createdTimezone: 'Asia/Shanghai',
    }, notifications)).rejects.toThrow('notification_permission_denied')
    expect(repository.reminders.get('reminder-denied')).toMatchObject({
      status: 'failed',
      errorCode: 'notification_permission_denied',
    })
  })

  it('reconciles missing registrations and lets the runtime fire overdue reminders', async () => {
    const now = Date.now()
    repository.reminders.set('missing', reminder({ id: 'missing', notificationId: 7 }))
    repository.reminders.set('overdue', reminder({ id: 'overdue', dueAtUtc: now - 1_000 }))
    const notifications = adapter()
    const result = await reconcileReadingReminders(notifications, now)
    expect(result).toEqual({ scheduled: 1, fired: 0, failed: 0, cancelled: 0 })
    expect(repository.reminders.get('missing')?.status).toBe('scheduled')
    await processDueReadingReminders(now)
    expect(repository.reminders.get('overdue')?.status).toBe('fired')
    expect(notificationRuntime.toastShow).toHaveBeenCalledWith(expect.objectContaining({
      title: '阅读提醒',
      duration: null,
    }))
  })

  it('combines reminders that become due in the same processing pass', async () => {
    const now = Date.now()
    repository.reminders.set('due-a', reminder({ id: 'due-a', title: '章节 A', dueAtUtc: now - 2 }))
    repository.reminders.set('due-b', reminder({ id: 'due-b', title: '章节 B', dueAtUtc: now - 1 }))
    await processDueReadingReminders(now)
    expect(notificationRuntime.toastShow).toHaveBeenCalledTimes(1)
    expect(notificationRuntime.toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '2 个阅读提醒已到期：章节 A、章节 B',
      duration: null,
    }))
    expect(repository.reminders.get('due-a')?.status).toBe('fired')
    expect(repository.reminders.get('due-b')?.status).toBe('fired')
  })

  it('finishes cancellation only after the notification adapter succeeds', async () => {
    repository.reminders.set('cancel-me', reminder({ id: 'cancel-me', notificationId: 9 }))
    const notifications = adapter()
    await cancelReadingReminder('cancel-me', notifications)
    expect(notifications.cancel).toHaveBeenCalledWith(9)
    expect(repository.reminders.get('cancel-me')?.status).toBe('cancelled')
  })

  it('retries a failed registration without creating another reminder', async () => {
    repository.reminders.set('retry-me', reminder({
      id: 'retry-me',
      status: 'failed',
      errorCode: 'notification_schedule_failed',
    }))
    const notifications = adapter()
    const retried = await retryReadingReminder('retry-me', notifications)
    expect(notifications.ensurePermission).toHaveBeenCalledWith(true)
    expect(notifications.schedule).toHaveBeenCalledTimes(1)
    expect(retried?.status).toBe('scheduled')
    expect(repository.reminders.size).toBe(1)
  })

  it('retries a failed cancellation as cancellation', async () => {
    repository.reminders.set('retry-cancel', reminder({
      id: 'retry-cancel',
      status: 'failed',
      notificationId: 19,
      errorCode: 'notification_cancel_failed',
    }))
    const notifications = adapter()
    const retried = await retryReadingReminder('retry-cancel', notifications)
    expect(notifications.cancel).toHaveBeenCalledWith(19)
    expect(notifications.schedule).not.toHaveBeenCalled()
    expect(retried?.status).toBe('cancelled')
  })

  it('edits a future reminder by cancelling the old schedule before replacing it', async () => {
    repository.reminders.set('edit-me', reminder({ id: 'edit-me', notificationId: 27 }))
    const notifications = adapter()
    const dueAtUtc = Date.now() + 120_000
    const edited = await editReadingReminderTime('edit-me', dueAtUtc, 'Asia/Shanghai', notifications)
    expect(notifications.cancel).toHaveBeenCalledWith(27)
    expect(notifications.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: 27, dueAtUtc }))
    expect(edited).toMatchObject({ dueAtUtc, status: 'scheduled', notificationId: 27 })
  })

  it('startup reconciliation cancels pending cancellations without requesting permission', async () => {
    repository.reminders.set('startup-cancel', reminder({
      id: 'startup-cancel',
      status: 'cancel_pending',
      notificationId: 31,
    }))
    const notifications = adapter({ ensurePermission: vi.fn(async () => false) })
    const result = await reconcileReadingReminders(notifications)
    expect(notifications.ensurePermission).toHaveBeenCalledWith(false)
    expect(notifications.cancel).toHaveBeenCalledWith(31)
    expect(repository.reminders.get('startup-cancel')?.status).toBe('cancelled')
    expect(result.cancelled).toBe(1)
  })

  it('startup reconciliation recognizes an existing native registration', async () => {
    repository.reminders.set('native-existing', reminder({
      id: 'native-existing',
      status: 'pending',
      notificationId: 37,
    }))
    const notifications = adapter({ pendingIds: vi.fn(async () => new Set([37])) })
    await reconcileReadingReminders(notifications)
    expect(notifications.schedule).not.toHaveBeenCalled()
    expect(repository.reminders.get('native-existing')?.status).toBe('scheduled')
  })
})
