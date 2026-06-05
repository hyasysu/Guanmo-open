export function normalizeFilePath(path: string | null | undefined): string {
  if (!path) return ''
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

export function isSameFilePath(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeFilePath(a)
  const right = normalizeFilePath(b)
  return Boolean(left && right && left === right)
}
