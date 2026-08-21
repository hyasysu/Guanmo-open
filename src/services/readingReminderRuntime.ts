import {
  loadReadingReminders,
  updateReadingReminderState,
  type ReadingReminder,
} from './database/readingReminders'
import { toast } from './toast'

const MAX_TIMER_DELAY_MS = 2_147_000_000
const FAILED_PERSIST_RETRY_MS = 5_000

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let activeProcessing: Promise<void> | null = null

function clearRuntimeTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function activeReminder(reminder: ReadingReminder): boolean {
  return reminder.status === 'pending' || reminder.status === 'scheduled'
}

function dueToast(reminders: ReadingReminder[]): void {
  const ids = reminders.map((reminder) => reminder.id).sort().join('-')
  if (reminders.length === 1) {
    const reminder = reminders[0]
    toast.show({
      id: `reading-reminder-due-${ids}`,
      title: '阅读提醒',
      message: reminder.description
        ? `${reminder.title}：${reminder.description}`
        : reminder.title,
      type: 'info',
      duration: null,
    })
    return
  }
  toast.show({
    id: `reading-reminders-due-${ids}`,
    title: '阅读提醒',
    message: `${reminders.length} 个阅读提醒已到期：${reminders.map((item) => item.title).join('、')}`,
    type: 'info',
    duration: null,
  })
}

async function armNextTimer(): Promise<void> {
  clearRuntimeTimer()
  if (!started) return
  const reminders = await loadReadingReminders()
  const nextDueAt = reminders
    .filter(activeReminder)
    .reduce<number | null>((nearest, reminder) => (
      nearest === null || reminder.dueAtUtc < nearest ? reminder.dueAtUtc : nearest
    ), null)
  if (nextDueAt === null) return
  const dueDelay = nextDueAt - Date.now()
  const delay = Math.min(MAX_TIMER_DELAY_MS, dueDelay <= 0 ? FAILED_PERSIST_RETRY_MS : dueDelay)
  timer = setTimeout(() => {
    void processDueReadingReminders()
  }, delay)
}

export async function processDueReadingReminders(now = Date.now()): Promise<void> {
  if (activeProcessing) return activeProcessing
  activeProcessing = (async () => {
    const reminders = await loadReadingReminders()
    const due = reminders.filter((reminder) => activeReminder(reminder) && reminder.dueAtUtc <= now)
    if (due.length > 0) {
      dueToast(due)
      const updates = await Promise.allSettled(
        due.map((reminder) => updateReadingReminderState(reminder.id, 'fired', { errorCode: null })),
      )
      if (updates.some((result) => result.status === 'rejected')) {
        console.warn('[Reminder] failed to persist one or more fired reminders')
      }
    }
  })().finally(async () => {
    activeProcessing = null
    await armNextTimer().catch(() => {
      console.warn('[Reminder] failed to arm the next reminder timer')
    })
  })
  return activeProcessing
}

export function refreshReadingReminderRuntime(): void {
  if (!started) return
  void processDueReadingReminders()
}

function handleRuntimeResume(): void {
  if (document.visibilityState === 'visible') refreshReadingReminderRuntime()
}

export function startReadingReminderRuntime(): void {
  if (started) return
  started = true
  window.addEventListener('focus', handleRuntimeResume)
  document.addEventListener('visibilitychange', handleRuntimeResume)
  refreshReadingReminderRuntime()
}

export function stopReadingReminderRuntime(): void {
  if (!started) return
  started = false
  clearRuntimeTimer()
  window.removeEventListener('focus', handleRuntimeResume)
  document.removeEventListener('visibilitychange', handleRuntimeResume)
}
