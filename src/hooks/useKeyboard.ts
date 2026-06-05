import { useEffect, useRef } from 'react'

type KeyHandler = (e: KeyboardEvent) => void

interface ShortcutMap {
  [key: string]: KeyHandler
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = buildKeyString(e)
      const handler = shortcutsRef.current[key]
      if (handler) {
        e.preventDefault()
        e.stopPropagation()
        handler(e)
      }
    }

    // Use capture phase to intercept before CodeMirror
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}

function buildKeyString(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CTRL')
  if (e.shiftKey) parts.push('SHIFT')
  if (e.altKey) parts.push('ALT')
  parts.push(normalizeKey(e))
  return parts.join('+')
}

function normalizeKey(e: KeyboardEvent): string {
  if (e.code.startsWith('Key')) return e.code.slice(3).toUpperCase()
  if (e.code.startsWith('Digit')) return e.code.slice(5)

  const codeMap: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backslash: '\\',
    Backquote: '`',
  }

  return codeMap[e.code] ?? e.key.toUpperCase()
}
