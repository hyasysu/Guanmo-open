import { useCallback, useReducer, useRef } from 'react'
import { renameFileEntry, validateFileName } from '@/services/fileEntryActions'
import { toast } from '@/services/toast'
import {
  INITIAL_RENAME_STATE,
  isRenameTargetActive,
  renameStateReducer,
  type RenameAction,
} from '@/services/renameState'

export function useFileRename() {
  const [state, dispatch] = useReducer(renameStateReducer, INITIAL_RENAME_STATE)
  const stateRef = useRef(state)

  const transition = useCallback((action: RenameAction) => {
    stateRef.current = renameStateReducer(stateRef.current, action)
    dispatch(action)
  }, [])

  const startRename = useCallback((targetId: string, value: string) => {
    transition({ type: 'start', targetId, value })
  }, [transition])

  const setRenameValue = useCallback((value: string) => {
    transition({ type: 'change', value })
  }, [transition])

  const cancelRename = useCallback((targetId: string) => {
    if (!isRenameTargetActive(stateRef.current, targetId)) return
    transition({ type: 'cancel' })
  }, [transition])

  const submitRename = useCallback(async (
    targetId: string,
    path: string,
    onSuccess?: () => void,
  ): Promise<boolean> => {
    const current = stateRef.current
    if (!isRenameTargetActive(current, targetId) || current.status === 'submitting') return false

    const error = validateFileName(current.value)
    if (error) {
      transition({ type: 'fail' })
      toast.error(error)
      return false
    }

    transition({ type: 'submit' })
    try {
      await renameFileEntry(path, current.value)
    } catch (err) {
      transition({ type: 'fail' })
      toast.error(err instanceof Error ? err.message : '重命名失败')
      return false
    }

    transition({ type: 'succeed' })
    onSuccess?.()
    toast.success('已重命名')
    return true
  }, [transition])

  return {
    state,
    startRename,
    setRenameValue,
    cancelRename,
    submitRename,
    isRenaming: useCallback((targetId: string) => isRenameTargetActive(state, targetId), [state]),
  }
}
