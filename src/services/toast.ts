import { useToastStore } from '@/stores/toastStore'

export const toast = {
  success: (message: string) => useToastStore.getState().addToast(message, 'success'),
  info: (message: string) => useToastStore.getState().addToast(message, 'info'),
  warning: (message: string) => useToastStore.getState().addToast(message, 'warning'),
  error: (message: string) => useToastStore.getState().addToast(message, 'error'),
}
