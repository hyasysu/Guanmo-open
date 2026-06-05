export interface TextRange {
  from: number
  to: number
}

function matchesTextAtRange(content: string, oldText: string, range?: TextRange): range is TextRange {
  return Boolean(
    range
    && range.from >= 0
    && range.to >= range.from
    && content.slice(range.from, range.to) === oldText
  )
}

export function resolveAnchoredReplacementRange(
  content: string,
  oldText: string,
  initialRange: TextRange,
  latestAppliedRange?: TextRange
): TextRange | null {
  if (matchesTextAtRange(content, oldText, latestAppliedRange)) return latestAppliedRange
  if (matchesTextAtRange(content, oldText, initialRange)) return initialRange
  return null
}
