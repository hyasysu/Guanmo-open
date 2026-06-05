import type { EditorView } from '@codemirror/view'

let activeView: EditorView | null = null

export function setActiveEditorView(view: EditorView | null) {
  activeView = view
}

export function getActiveEditorView(): EditorView | null {
  return activeView
}
