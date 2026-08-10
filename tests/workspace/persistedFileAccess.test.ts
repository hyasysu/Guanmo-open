import { describe, expect, it } from 'vitest'
import { collectLegacyFileAccessPaths } from '@/services/persistedFileAccess'

describe('multi-root persisted file access migration', () => {
  it('submits every workspace root while keeping file paths globally deduplicated', () => {
    const result = collectLegacyFileAccessPaths({
      workspacePaths: ['D:/Notes', 'E:/Study', 'F:/Personal'],
      recentFiles: [{ path: 'D:/Notes/a.md' }],
      favorites: ['d:\\notes\\A.md', 'E:/Study/b.md'],
      tabs: [{ filePath: 'F:/Personal/c.md' }],
      documentPaths: ['E:/Study/b.md'],
      chatSourcePaths: [],
    })

    expect(result.workspacePaths).toEqual(['D:/Notes', 'E:/Study', 'F:/Personal'])
    expect(result.filePaths).toEqual(['D:/Notes/a.md', 'E:/Study/b.md', 'F:/Personal/c.md'])
  })
})
