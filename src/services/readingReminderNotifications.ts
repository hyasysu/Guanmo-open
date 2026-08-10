import { invoke, isTauri } from '@tauri-apps/api/core'

const DEFAULT_REMINDER_BODY = '该回到观墨继续阅读了。'

export interface ReadingReminderNotificationAdapter {
  ensurePermission(request: boolean): Promise<boolean>
  schedule(input: { id: number; title: string; body?: string; dueAtUtc: number }): Promise<void>
  pendingIds(): Promise<Set<number>>
  cancel(id: number): Promise<void>
}

async function loadNotificationPlugin() {
  if (!isTauri()) throw new Error('notification_unavailable')
  return import('@tauri-apps/plugin-notification')
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
  async ensurePermission(request) {
    const plugin = await loadNotificationPlugin()
    if (await plugin.isPermissionGranted()) return true
    if (!request) return false
    return (await plugin.requestPermission()) === 'granted'
  },

  async schedule(input) {
    if (!Number.isInteger(input.id) || input.id <= 0) throw new Error('notification_id_invalid')
    if (!Number.isFinite(input.dueAtUtc) || input.dueAtUtc <= Date.now()) {
      throw new Error('reminder_due_time_invalid')
    }
    await loadNotificationPlugin()
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
    await loadNotificationPlugin()
    const ids = await invoke<number[]>('list_pending_reading_reminder_notification_ids')
    return new Set(ids.filter((id) => Number.isInteger(id) && id > 0))
  },

  async cancel(id) {
    await loadNotificationPlugin()
    if (!Number.isInteger(id) || id <= 0) throw new Error('notification_id_invalid')
    await invoke('cancel_reading_reminder_notification', { id })
  },
}
