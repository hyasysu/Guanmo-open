import { describe, expect, it } from 'vitest'
import {
  buildMemoryCountQuery,
  buildMemoryQuery,
} from '@/services/database/memoryQuery'

describe('memoryQuery', () => {
  it('builds a lightweight, stable, filtered page query', () => {
    const query = buildMemoryQuery({
      statuses: ['active'],
      category: 'project',
      scopeType: 'project',
      scopeKey: 'd:/anonymous-workspace',
      includeGlobalForProject: false,
      limit: 20,
      offset: 40,
    })

    expect(query.sql).not.toMatch(/(?:,|SELECT )\s*embedding(?:,|\s+FROM)/)
    expect(query.sql).toContain('category = $1')
    expect(query.sql).toContain('status IN ($2)')
    expect(query.sql).toContain("scope_type = 'project' AND scope_key = $3")
    expect(query.sql).not.toContain("COALESCE(scope_type, 'global') = 'global'\n      OR")
    expect(query.sql).toContain('ORDER BY updated_at DESC, id ASC LIMIT $4 OFFSET $5')
    expect(query.params).toEqual([
      'project',
      'active',
      'd:/anonymous-workspace',
      20,
      40,
    ])
  })

  it('keeps the legacy project scope and unpaged embedding query compatible', () => {
    const projectQuery = buildMemoryQuery({
      statuses: ['active'],
      scopeType: 'project',
      scopeKey: 'd:/anonymous-workspace',
    })
    const legacyQuery = buildMemoryQuery({ includeEmbedding: true })

    expect(projectQuery.sql).toContain("COALESCE(scope_type, 'global') = 'global'")
    expect(projectQuery.sql).toContain("scope_type = 'project' AND scope_key = $2")
    expect(projectQuery.params).toEqual(['active', 'd:/anonymous-workspace'])
    expect(legacyQuery.sql).toContain(', embedding FROM memories')
    expect(legacyQuery.sql).not.toContain(' LIMIT ')
    expect(legacyQuery.params).toEqual([])
  })

  it('constrains pagination values and excludes them from count queries', () => {
    const pageQuery = buildMemoryQuery({
      statuses: ['candidate'],
      limit: 999,
      offset: -12,
    })
    const countQuery = buildMemoryCountQuery({
      statuses: ['archived', 'superseded'],
      includeEmbedding: true,
      limit: 20,
      offset: 20,
    })

    expect(pageQuery.params).toEqual(['candidate', 200, 0])
    expect(pageQuery.sql).toContain('ORDER BY updated_at DESC, id ASC LIMIT $2 OFFSET $3')
    expect(countQuery.sql).toBe('SELECT COUNT(*) AS total FROM memories WHERE status IN ($1, $2)')
    expect(countQuery.params).toEqual(['archived', 'superseded'])
  })
})
