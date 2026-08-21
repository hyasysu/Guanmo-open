import { invoke, isTauri } from '@tauri-apps/api/core'

const DEFAULT_REMINDER_BODY = '该回到观墨继续阅读了。'

export interface ReadingReminderNotificationAdapter {
  ensurePermission(request: boolean): Promise<boolean>
  schedule(input: { id: number; title: string; body?: string; dueAtUtc: number }): Promise<void>
  pendingIds(): Promise<Set<number>>
  cancel(id: number): Promise<void>
}

export interface WindowsNotificationStatus {
  supported: boolean
  registered: boolean
  errorCode: string | null
}

function ensureDesktopRuntime(): void {
  if (!isTauri()) throw new Error('notification_unavailable')
}

export async function getWindowsNotificationStatus(): Promise<WindowsNotificationStatus> {
  ensureDesktopRuntime()
  return invoke<WindowsNotificationStatus>('get_windows_notification_status')
}

export async function showWindowsNotification(input: { title: string; body: string }): Promise<void> {
  ensureDesktopRuntime()
  await invoke('show_windows_notification', { input })
}

export function notificationIdForReminder(reminderId: string): number {
  let hash = 2166136261
  for (let index = 0; index < reminderId.length; index += 1) {
    hash ^= reminderId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 1) || 1
}

export const readingReminderNotificationAdapter: ReadingReminderNotificationAdapter = {
  async ensurePermission(_request) {
    const status = await getWindowsNotificationStatus()
    if (status.errorCode && status.errorCode !== 'unsupported_platform') {
      throw new Error(status.errorCode)
    }
    return status.supported && status.registered
  },

  async schedule(input) {
    if (!Number.isInteger(input.id) || input.id <= 0) throw new Error('notification_id_invalid')
    if (!Number.isFinite(input.dueAtUtc) || input.dueAtUtc <= Date.now()) {
      throw new Error('reminder_due_time_invalid')
    }
    ensureDesktopRuntime()
    await invoke('schedule_reading_reminder_notification', {
      input: {
        id: input.id,
        title: input.title,
        body: input.body?.trim() || DEFAULT_REMINDER_BODY,
        dueAtUtc: Math.floor(input.dueAtUtc),
      },
    })
  },

  async pendingIds() {
    ensureDesktopRuntime()
    const ids = await invoke<number[]>('list_pending_reading_reminder_notification_ids')
    return new Set(ids.filter((id) => Number.isInteger(id) && id > 0))
  },

  async cancel(id) {
    ensureDesktopRuntime()
    if (!Number.isInteger(id) || id <= 0) throw new Error('notification_id_invalid')
    await invoke('cancel_reading_reminder_notification', { id })
  },
}
