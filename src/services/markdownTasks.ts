const TASK_MARKER_PATTERN = /\[( |x|X)\]/

export function toggleMarkdownTaskAtLine(content: string, lineNumber: number, checked: boolean): string | null {
  if (lineNumber < 1) return null

  const lines = content.split('\n')
  const lineIndex = lineNumber - 1
  const line = lines[lineIndex]

  if (line === undefined) return null

  const match = line.match(TASK_MARKER_PATTERN)
  if (!match || match.index === undefined) return null

  const nextMarker = checked ? '[x]' : '[ ]'
  const currentMarker = match[0]

  if (currentMarker === nextMarker) return content

  lines[lineIndex] =
    line.slice(0, match.index) +
    nextMarker +
    line.slice(match.index + currentMarker.length)

  return lines.join('\n')
}
