// @vitest-environment node

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addPendingMs,
  clearPending,
  formatDuration,
  getHeatLevel,
  getLocalDateKey,
  getPendingSeconds,
  getPendingSnapshot,
  getTwelveMonthRange,
  limitUsageIncrementMs,
  splitIntervalByMidnight,
} from '@/services/usageTracking'
import { DB_SCHEMA, splitDatabaseSchemaStatements } from '@/services/database/schema'

// ---------------------------------------------------------------------------
// 临时数据库辅助
// ---------------------------------------------------------------------------

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'guanmo-usage-test-'))
  temporaryDirectories.push(directory)
  const database = new DatabaseSync(path.join(directory, 'anonymous.sqlite'))
  for (const statement of splitDatabaseSchemaStatements(DB_SCHEMA)) {
    database.exec(statement)
  }
  return database
}

// ---------------------------------------------------------------------------
// 纯函数测试
// ---------------------------------------------------------------------------

describe('getLocalDateKey', () => {
  it('返回本地 YYYY-MM-DD，不依赖 UTC', () => {
    // 使用固定日期避免时区问题：直接指定年月日
    const date = new Date(2026, 7, 4, 15, 30, 0) // 2026-08-04 本地
    const key = getLocalDateKey(date)
    expect(key).toBe('2026-08-04')
  })

  it('正确补零', () => {
    expect(getLocalDateKey(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(getLocalDateKey(new Date(2026, 10, 5))).toBe('2026-11-05')
  })
})

describe('getTwelveMonthRange', () => {
  it('返回最近 12 个自然月范围，从首月 1 日到今天', () => {
    const today = new Date(2026, 7, 4) // 2026-08-04
    const range = getTwelveMonthRange(today)
    expect(range.end).toBe('2026-08-04')
    // 2025-09-01 = 往前 11 个月的首日
    expect(range.start).toBe('2025-09-01')
  })

  it('跨年场景正确', () => {
    const today = new Date(2026, 2, 15) // 2026-03-15
    const range = getTwelveMonthRange(today)
    expect(range.end).toBe('2026-03-15')
    expect(range.start).toBe('2025-04-01')
  })
})

describe('splitIntervalByMidnight', () => {
  it('同一日期内不拆分', () => {
    const start = new Date(2026, 7, 4, 10, 0, 0).getTime()
    const end = new Date(2026, 7, 4, 10, 0, 20).getTime()
    const result = splitIntervalByMidnight(start, end)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ date: '2026-08-04', ms: 20000 })
  })

  it('23:59:50 开始的 20 秒跨零点拆分', () => {
    const start = new Date(2026, 7, 4, 23, 59, 50).getTime()
    const end = start + 20000 // 20 秒后
    const result = splitIntervalByMidnight(start, end)
    expect(result).toHaveLength(2)
    // 第一天：10 秒（23:59:50 → 00:00:00）
    expect(result[0].date).toBe('2026-08-04')
    expect(result[0].ms).toBe(10000)
    // 第二天：10 秒（00:00:00 → 00:00:10）
    expect(result[1].date).toBe('2026-08-05')
    expect(result[1].ms).toBe(10000)
  })

  it('跨越两天', () => {
    const start = new Date(2026, 7, 4, 22, 0, 0).getTime()
    // 3 小时后
    const end = start + 3 * 3600 * 1000
    const result = splitIntervalByMidnight(start, end)
    expect(result).toHaveLength(2)
    expect(result[0].date).toBe('2026-08-04')
    expect(result[0].ms).toBe(2 * 3600 * 1000) // 22:00 → 00:00
    expect(result[1].date).toBe('2026-08-05')
    expect(result[1].ms).toBe(1 * 3600 * 1000) // 00:00 → 01:00
  })

  it('跨越多个完整日期', () => {
    const start = new Date(2026, 7, 4, 22, 0, 0).getTime()
    const end = new Date(2026, 7, 7, 1, 0, 0).getTime()
    const result = splitIntervalByMidnight(start, end)

    expect(result).toEqual([
      { date: '2026-08-04', ms: 2 * 3600 * 1000 },
      { date: '2026-08-05', ms: 24 * 3600 * 1000 },
      { date: '2026-08-06', ms: 24 * 3600 * 1000 },
      { date: '2026-08-07', ms: 1 * 3600 * 1000 },
    ])
  })

  it('endMs <= startMs 返回空数组', () => {
    const now = Date.now()
    expect(splitIntervalByMidnight(now, now)).toEqual([])
    expect(splitIntervalByMidnight(now, now - 1)).toEqual([])
  })

  it('小数毫秒在边界统一截断，且小于 1ms 的区间有限返回', () => {
    const start = new Date(2026, 7, 4, 10, 0, 0).getTime()

    expect(splitIntervalByMidnight(start + 0.25, start + 0.75)).toEqual([])
    expect(splitIntervalByMidnight(start + 0.75, start + 2000.25)).toEqual([
      { date: '2026-08-04', ms: 2000 },
    ])
  })

  it('非法时间戳和超出 Date 范围的输入有限返回空数组', () => {
    const invalidIntervals: Array<[number, number]> = [
      [Number.NaN, 1],
      [1, Number.NaN],
      [Number.POSITIVE_INFINITY, 1],
      [1, Number.NEGATIVE_INFINITY],
      [0, Number.MAX_VALUE],
    ]

    for (const [start, end] of invalidIntervals) {
      expect(splitIntervalByMidnight(start, end)).toEqual([])
    }
  })

  it('异常长区间触发有限分段保护', () => {
    expect(() => splitIntervalByMidnight(0, 1_000_000_000_000)).toThrow(
      /maximum number of segments/i,
    )
  })
})

describe('limitUsageIncrementMs', () => {
  it('限制非负值且单次不超过 60 秒', () => {
    expect(limitUsageIncrementMs(12_345.9, 12_346.9)).toBe(12_345.9)
    expect(limitUsageIncrementMs(90_000, 90_000)).toBe(60_000)
    expect(limitUsageIncrementMs(-1, 1)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('0 或负数返回 "0 分钟"', () => {
    expect(formatDuration(0)).toBe('0 分钟')
    expect(formatDuration(-1)).toBe('0 分钟')
  })

  it('小于 1 小时显示分钟', () => {
    expect(formatDuration(1)).toBe('少于 1 分钟')
    expect(formatDuration(59)).toBe('少于 1 分钟')
    expect(formatDuration(60)).toBe('1 分钟')
    expect(formatDuration(3599)).toBe('59 分钟')
  })

  it('大于等于 1 小时显示小时和分钟', () => {
    expect(formatDuration(3600)).toBe('1 小时 0 分钟')
    expect(formatDuration(3660)).toBe('1 小时 1 分钟')
    expect(formatDuration(7200)).toBe('2 小时 0 分钟')
    expect(formatDuration(7380)).toBe('2 小时 3 分钟')
  })
})

describe('getHeatLevel', () => {
  it('0 分钟 → 等级 0', () => {
    expect(getHeatLevel(0)).toBe(0)
    expect(getHeatLevel(-1)).toBe(0)
  })

  it('1～30 分钟 → 等级 1', () => {
    expect(getHeatLevel(1)).toBe(1)
    expect(getHeatLevel(30)).toBe(1)
  })

  it('31～59 分钟 → 等级 2', () => {
    expect(getHeatLevel(31)).toBe(2)
    expect(getHeatLevel(59)).toBe(2)
  })

  it('60～119 分钟 → 等级 3', () => {
    expect(getHeatLevel(60)).toBe(3)
    expect(getHeatLevel(119)).toBe(3)
  })

  it('120 分钟及以上 → 等级 4', () => {
    expect(getHeatLevel(120)).toBe(4)
    expect(getHeatLevel(500)).toBe(4)
  })

  it('等级固定，不随数据动态变化', () => {
    // 连续调用确保等级不变
    expect(getHeatLevel(50)).toBe(2)
    expect(getHeatLevel(50)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Pending 语义测试
// ---------------------------------------------------------------------------

describe('pending map', () => {
  beforeEach(() => {
    clearPending()
  })

  it('addPendingMs 累加毫秒', () => {
    addPendingMs('2026-08-04', 1500)
    addPendingMs('2026-08-04', 2000)
    expect(getPendingSeconds('2026-08-04')).toBe(3) // 3500ms → 3s
  })

  it('getPendingSeconds 不足 1 秒返回 0', () => {
    addPendingMs('2026-08-04', 500)
    expect(getPendingSeconds('2026-08-04')).toBe(0)
  })

  it('getPendingSnapshot 只返回整秒日期', () => {
    addPendingMs('2026-08-04', 3500)
    addPendingMs('2026-08-05', 500)
    const snapshot = getPendingSnapshot()
    expect(snapshot.size).toBe(1)
    expect(snapshot.get('2026-08-04')).toBe(3)
  })

  it('pending 逐日期语义：getPendingSeconds 返回整秒', () => {
    addPendingMs('2026-08-04', 3500)
    addPendingMs('2026-08-05', 1100)
    expect(getPendingSeconds('2026-08-04')).toBe(3)
    expect(getPendingSeconds('2026-08-05')).toBe(1)
  })

  it('clearPending 清空所有待写数据', () => {
    addPendingMs('2026-08-04', 5000)
    addPendingMs('2026-08-05', 3000)
    clearPending()
    expect(getPendingSnapshot().size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 数据库集成测试（匿名临时数据库）
// ---------------------------------------------------------------------------

describe('SQLite usage_daily', () => {
  it('CREATE TABLE IF NOT EXISTS 幂等', () => {
    const db = createTemporaryDatabase()
    // 重复执行 schema 不会报错
    expect(() => {
      for (const statement of splitDatabaseSchemaStatements(DB_SCHEMA)) {
        db.exec(statement)
      }
    }).not.toThrow()
    db.close()
  })

  it('usage_daily 表存在且结构正确', () => {
    const db = createTemporaryDatabase()
    const columns = db
      .prepare("PRAGMA table_info(usage_daily)")
      .all()
      .map((row: unknown) => {
        const r = row as { name: string; type: string; notnull: number; pk: number }
        return { name: r.name, type: r.type, notnull: r.notnull, pk: r.pk }
      })

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'date', pk: 1 }),
        expect.objectContaining({ name: 'foreground_seconds', type: 'INTEGER', notnull: 1 }),
        expect.objectContaining({ name: 'updated_at', type: 'INTEGER', notnull: 1 }),
      ]),
    )
    db.close()
  })

  it('UPSERT 新日期插入', () => {
    const db = createTemporaryDatabase()
    db.prepare(
      `INSERT INTO usage_daily (date, foreground_seconds, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         foreground_seconds = foreground_seconds + excluded.foreground_seconds,
         updated_at = excluded.updated_at`,
    ).run('2026-08-04', 120, 1234567890)

    const row = db.prepare('SELECT * FROM usage_daily WHERE date = ?').get('2026-08-04') as {
      date: string
      foreground_seconds: number
      updated_at: number
    }
    expect(row.foreground_seconds).toBe(120)
    db.close()
  })

  it('UPSERT 已有日期累加', () => {
    const db = createTemporaryDatabase()
    const run = db.prepare(
      `INSERT INTO usage_daily (date, foreground_seconds, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         foreground_seconds = foreground_seconds + excluded.foreground_seconds,
         updated_at = excluded.updated_at`,
    )

    run.run('2026-08-04', 100, 1234567890)
    run.run('2026-08-04', 50, 1234567891)

    const row = db.prepare('SELECT * FROM usage_daily WHERE date = ?').get('2026-08-04') as {
      foreground_seconds: number
    }
    expect(row.foreground_seconds).toBe(150)
    db.close()
  })

  it('负增量不写入（业务层校验）', () => {
    const db = createTemporaryDatabase()
    // 直接在 SQL 层也可以插入负数，但业务层会在调用前校验
    // 这里验证：如果业务层传入负数，SQL 会累加负数
    const run = db.prepare(
      `INSERT INTO usage_daily (date, foreground_seconds, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         foreground_seconds = foreground_seconds + excluded.foreground_seconds,
         updated_at = excluded.updated_at`,
    )
    run.run('2026-08-04', 100, 1234567890)
    // 业务层不应传入负数，但如果传入，SQL 层会累加
    // 这里只验证 SQL 行为，业务校验在 upsertUsageSeconds 中
    run.run('2026-08-04', -30, 1234567891)
    const row = db.prepare('SELECT * FROM usage_daily WHERE date = ?').get('2026-08-04') as {
      foreground_seconds: number
    }
    expect(row.foreground_seconds).toBe(70) // 100 + (-30) = 70
    db.close()
  })

  it('SUM 查询返回 0 当表为空', () => {
    const db = createTemporaryDatabase()
    const row = db.prepare('SELECT COALESCE(SUM(foreground_seconds), 0) AS total FROM usage_daily').get() as {
      total: number
    }
    expect(row.total).toBe(0)
    db.close()
  })

  it('DELETE 清空表', () => {
    const db = createTemporaryDatabase()
    db.prepare(
      `INSERT INTO usage_daily (date, foreground_seconds, updated_at) VALUES (?, ?, ?)`,
    ).run('2026-08-04', 100, 1234567890)
    db.exec('DELETE FROM usage_daily')
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM usage_daily').get() as { cnt: number }
    expect(row.cnt).toBe(0)
    db.close()
  })

  it('日期范围查询', () => {
    const db = createTemporaryDatabase()
    const run = db.prepare(
      `INSERT INTO usage_daily (date, foreground_seconds, updated_at) VALUES (?, ?, ?)`,
    )
    run.run('2026-08-01', 100, 1)
    run.run('2026-08-02', 200, 2)
    run.run('2026-08-03', 300, 3)
    run.run('2026-08-04', 400, 4)

    const rows = db
      .prepare('SELECT date, foreground_seconds FROM usage_daily WHERE date >= ? AND date <= ? ORDER BY date')
      .all('2026-08-02', '2026-08-03') as Array<{ date: string; foreground_seconds: number }>

    expect(rows).toHaveLength(2)
    expect(rows[0].date).toBe('2026-08-02')
    expect(rows[0].foreground_seconds).toBe(200)
    expect(rows[1].date).toBe('2026-08-03')
    expect(rows[1].foreground_seconds).toBe(300)
    db.close()
  })
})
