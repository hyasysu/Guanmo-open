import { getDatabase, isDatabaseReady } from './db'

export type ReadingReminderStatus =
  | 'pending'
  | 'scheduled'
  | 'fired'
  | 'cancel_pending'
  | 'cancelled'
  | 'failed'

export interface ReadingReminder {
  id: string
  title: string
  description: string | null
  dueAtUtc: number
  createdTimezone: string
  status: ReadingReminderStatus
  sourceArtifactId: string | null
  sourceFilePath: string | null
  sourceMessageId: string | null
  notificationId: number | null
  errorCode: string | null
  createdAt: number
  updatedAt: number
}

export interface ReadingReminderRow {
  id: string
  title: string
  description: string | null
  due_at_utc: number
  created_timezone: string
  status: string
  source_artifact_id: string | null
  source_file_path: string | null
  source_message_id: string | null
  notification_id: number | null
  error_code: string | null
  created_at: number
  updated_at: number
}

const REMINDER_STATUSES: readonly ReadingReminderStatus[] = [
  'pending',
  'scheduled',
  'fired',
  'cancel_pending',
  'cancelled',
  'failed',
]

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`reading_reminders.${field} 缺失或无效`)
  }
  return value
}

function decodeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('reading_reminders 时间戳无效')
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function decodeReadingReminder(row: ReadingReminderRow): ReadingReminder {
  if (!REMINDER_STATUSES.includes(row.status as ReadingReminderStatus)) {
    throw new Error(`reading_reminders.status 未知：${row.status}`)
  }
  if (row.notification_id !== null && (!Number.isInteger(row.notification_id) || row.notification_id <= 0)) {
    throw new Error('reading_reminders.notification_id 无效')
  }
  return {
    id: requiredString(row.id, 'id'),
    title: requiredString(row.title, 'title'),
    description: row.description || null,
    dueAtUtc: decodeTimestamp(row.due_at_utc),
    createdTimezone: requiredString(row.created_timezone, 'created_timezone'),
    status: row.status as ReadingReminderStatus,
    sourceArtifactId: row.source_artifact_id || null,
    sourceFilePath: row.source_file_path || null,
    sourceMessageId: row.source_message_id || null,
    notificationId: row.notification_id,
    errorCode: row.error_code || null,
    createdAt: decodeTimestamp(row.created_at),
    updatedAt: decodeTimestamp(row.updated_at),
  }
}

export interface PersistReadingReminderInput {
  id: string
  title: string
  description?: string | null
  dueAtUtc: number
  createdTimezone: string
  status?: ReadingReminderStatus
  sourceArtifactId?: string | null
  sourceFilePath?: string | null
  sourceMessageId?: string | null
  notificationId?: number | null
  errorCode?: string | null
}

export async function persistReadingReminder(input: PersistReadingReminderInput): Promise<void> {
  if (!isDatabaseReady()) throw new Error('数据库尚未就绪')
  const now = Math.floor(Date.now() / 1000)
  await getDatabase().execute(
    `INSERT INTO reading_reminders (
       id, title, description, due_at_utc, created_timezone, status,
       source_artifact_id, source_file_path, source_message_id,
       notification_id, error_code, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       COALESCE((SELECT created_at FROM reading_reminders WHERE id = $1), $12), $13)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       due_at_utc = excluded.due_at_utc,
       created_timezone = excluded.created_timezone,
       status = excluded.status,
       source_artifact_id = excluded.source_artifact_id,
       source_file_path = excluded.source_file_path,
       source_message_id = excluded.source_message_id,
       notification_id = excluded.notification_id,
       error_code = excluded.error_code,
       updated_at = excluded.updated_at`,
    [
      input.id,
      input.title,
      input.description || null,
      Math.floor(input.dueAtUtc),
      input.createdTimezone,
      input.status ?? 'pending',
      input.sourceArtifactId || null,
      input.sourceFilePath || null,
      input.sourceMessageId || null,
      input.notificationId ?? null,
      input.errorCode || null,
      now,
      now,
    ],
  )
}

export async function loadReadingReminders(): Promise<ReadingReminder[]> {
  if (!isDatabaseReady()) return []
  const rows = await getDatabase().select<ReadingReminderRow>(
    'SELECT * FROM reading_reminders ORDER BY due_at_utc ASC, created_at ASC',
  )
  return rows.map(decodeReadingReminder)
}

export async function loadReadingReminderById(id: string): Promise<ReadingReminder | undefined> {
  if (!isDatabaseReady()) return undefined
  const rows = await getDatabase().select<ReadingReminderRow>(
    'SELECT * FROM reading_reminders WHERE id = $1',
    [id],
  )
  return rows[0] ? decodeReadingReminder(rows[0]) : undefined
}

export async function updateReadingReminderState(
  id: string,
  status: ReadingReminderStatus,
  options: { notificationId?: number | null; errorCode?: string | null } = {},
): Promise<void> {
  if (!isDatabaseReady()) throw new Error('数据库尚未就绪')
  await getDatabase().execute(
    `UPDATE reading_reminders
     SET status = $1,
         notification_id = CASE WHEN $2 THEN $3 ELSE notification_id END,
         error_code = $4,
         updated_at = $5
     WHERE id = $6`,
    [
      status,
      Object.prototype.hasOwnProperty.call(options, 'notificationId'),
      options.notificationId ?? null,
      options.errorCode || null,
      Math.floor(Date.now() / 1000),
      id,
    ],
  )
}

export interface ReadingReminderBackupEntry {
  id: string
  title: string
  description: string | null
  dueAtUtc: number
  createdTimezone: string
  status: string
  sourceArtifactId: string | null
  sourceFilePath: string | null
  sourceMessageId: string | null
  notificationId: number | null
  errorCode: string | null
  createdAt: number
  updatedAt: number
}

export async function loadReadingRemindersForBackup(): Promise<ReadingReminderBackupEntry[]> {
  const reminders = await loadReadingReminders()
  return reminders.map((reminder) => ({
    id: reminder.id,
    title: reminder.title,
    description: reminder.description,
    dueAtUtc: reminder.dueAtUtc,
    createdTimezone: reminder.createdTimezone,
    status: reminder.status,
    sourceArtifactId: reminder.sourceArtifactId,
    sourceFilePath: reminder.sourceFilePath,
    sourceMessageId: reminder.sourceMessageId,
    notificationId: reminder.notificationId,
    errorCode: reminder.errorCode,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  }))
}
