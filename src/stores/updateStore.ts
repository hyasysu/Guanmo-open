import { create } from 'zustand'
import type { AvailableUpdate } from '@/services/updateService'

interface UpdateState {
  selectedUpdate: AvailableUpdate | null
  showDetails: (update: AvailableUpdate) => void
  closeDetails: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  selectedUpdate: null,
  showDetails: (selectedUpdate) => set({ selectedUpdate }),
  closeDetails: () => set({ selectedUpdate: null }),
}))
