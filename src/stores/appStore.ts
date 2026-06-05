import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  sidebarCollapsed: boolean
  aiPanelOpen: boolean
  sidebarWidth: number
  aiPanelWidth: number
  workspacePath: string | null

  toggleSidebar: () => void
  toggleAiPanel: () => void
  setSidebarWidth: (width: number) => void
  setAiPanelWidth: (width: number) => void
  setWorkspacePath: (path: string | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      aiPanelOpen: true,
      sidebarWidth: 260,
      aiPanelWidth: 360,
      workspacePath: null,

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setAiPanelWidth: (width) => set({ aiPanelWidth: width }),
      setWorkspacePath: (path) => set({ workspacePath: path }),
    }),
    {
      name: 'guanmo-app',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        aiPanelOpen: state.aiPanelOpen,
        sidebarWidth: state.sidebarWidth,
        aiPanelWidth: state.aiPanelWidth,
        workspacePath: state.workspacePath,
      }),
    }
  )
)
