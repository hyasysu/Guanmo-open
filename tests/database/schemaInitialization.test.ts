// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_SCHEMA, splitDatabaseSchemaStatements } from '@/services/database/schema'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'guanmo-test-'))
  temporaryDirectories.push(directory)
  const database = new DatabaseSync(path.join(directory, 'anonymous.sqlite'))
  return database
}

function initialize(database: DatabaseSync) {
  for (const statement of splitDatabaseSchemaStatements(DB_SCHEMA)) {
    database.exec(statement)
  }
}

describe('SQLite Schema 初始化', () => {
  it('首次初始化创建核心表', () => {
    const database = createTemporaryDatabase()
    initialize(database)

    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map((row) => String(row.name))

    expect(tables).toEqual(expect.arrayContaining(['documents', 'chunks', 'chat_sessions', 'chat_messages', 'memories', 'settings']))
    database.close()
  })

  it('同一临时数据库重复初始化保持幂等且保留数据', () => {
    const database = createTemporaryDatabase()
    initialize(database)
    database.prepare("INSERT INTO settings (key, value) VALUES ('anonymous.setting', 'kept')").run()

    expect(() => initialize(database)).not.toThrow()
    expect(database.prepare("SELECT value FROM settings WHERE key = 'anonymous.setting'").get()).toMatchObject({ value: 'kept' })
    database.close()
  })
})
