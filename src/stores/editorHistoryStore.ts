import { create } from 'zustand'

interface EditorHistoryState {
  canUndo: boolean
  canRedo: boolean
  setCanUndo: (v: boolean) => void
  setCanRedo: (v: boolean) => void
}

export const useEditorHistoryStore = create<EditorHistoryState>((set) => ({
  canUndo: false,
  canRedo: false,
  setCanUndo: (v) => set({ canUndo: v }),
  setCanRedo: (v) => set({ canRedo: v }),
}))
