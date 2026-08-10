import { fileExists } from '@/hooks/useTauri'
import { listDirectory } from '@/services/fileSystem'
import { normalizeFilePath } from '@/services/pathIdentity'
import { normalizeWorkspacePath } from '@/services/workspaceIdentity'
import { listEmbeddingJobs, loadDocumentFilePaths, removeEmbeddingJobByPath, removePersistedDocumentByPath } from '@/services/database/persistence'
import { indexWorkspaceMarkdown, type WorkspaceIndexResult } from '@/services/rag/indexer'
import { vectorStore } from '@/services/rag/vectorStore'
import { removeNativeRagIndexDocument } from '@/services/rag/nativeIndex'

export interface WorkspaceCleanupResult {
  removed: number
  removedPaths: string[]
  errors: string[]
}

export interface WorkspaceRebuildResult extends WorkspaceIndexResult {
  removed: number
  removedPaths: string[]
}

function isInsideWorkspace(filePath: string, workspacePath: string) {
  const file = normalizeFilePath(filePath)
  const workspace = normalizeWorkspacePath(workspacePath)
  return file === workspace || file.startsWith(`${workspace}/`)
}

function toWorkspacePaths(workspacePaths: string | string[]): string[] {
  const paths = Array.isArray(workspacePaths) ? workspacePaths : [workspacePaths]
  const seen = new Set<string>()
  return paths.filter((path) => {
    const identity = normalizeWorkspacePath(path)
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

async function getReadableWorkspacePaths(workspacePaths: string[]): Promise<{ readable: string[]; errors: string[] }> {
  const readable: string[] = []
  const errors: string[] = []
  for (const workspacePath of workspacePaths) {
    try {
      await listDirectory(workspacePath)
      readable.push(workspacePath)
    } catch (error) {
      errors.push(`${workspacePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { readable, errors }
}

export async function cleanupMissingWorkspaceDocuments(workspacePaths: string | string[]): Promise<WorkspaceCleanupResult> {
  const { readable, errors } = await getReadableWorkspacePaths(toWorkspacePaths(workspacePaths))
  const filePaths = await loadDocumentFilePaths()
  const jobPaths = (await listEmbeddingJobs()).map((job) => job.filePath)
  const paths = Array.from(new Set([...filePaths, ...jobPaths]))
  const removedPaths: string[] = []

  for (const filePath of paths) {
    if (!readable.some((workspacePath) => isInsideWorkspace(filePath, workspacePath))) continue
    const exists = await fileExists(filePath).catch(() => false)
    if (exists) continue
    vectorStore.removeByFilePath(filePath)
    await removePersistedDocumentByPath(filePath)
    await removeNativeRagIndexDocument(filePath)
    await removeEmbeddingJobByPath(filePath)
    removedPaths.push(filePath)
  }

  return {
    removed: removedPaths.length,
    removedPaths,
    errors,
  }
}

export async function rebuildWorkspaceDocuments(workspacePaths: string | string[]): Promise<WorkspaceRebuildResult> {
  const { readable, errors } = await getReadableWorkspacePaths(toWorkspacePaths(workspacePaths))
  const documentPaths = await loadDocumentFilePaths()
  const removedPaths: string[] = []

  for (const filePath of documentPaths) {
    if (!readable.some((workspacePath) => isInsideWorkspace(filePath, workspacePath))) continue
    vectorStore.removeByFilePath(filePath)
    await removePersistedDocumentByPath(filePath)
    await removeNativeRagIndexDocument(filePath)
    await removeEmbeddingJobByPath(filePath)
    removedPaths.push(filePath)
  }

  const result: WorkspaceIndexResult = { indexed: 0, skipped: 0, failed: errors.length, errors: [...errors] }
  for (const workspacePath of readable) {
    const indexed = await indexWorkspaceMarkdown(workspacePath)
    result.indexed += indexed.indexed
    result.skipped += indexed.skipped
    result.failed += indexed.failed
    result.errors.push(...indexed.errors)
  }
  return {
    ...result,
    removed: removedPaths.length,
    removedPaths,
  }
}
