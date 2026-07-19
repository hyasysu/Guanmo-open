export type RenameStatus = 'idle' | 'editing' | 'submitting' | 'success' | 'failed' | 'cancelled'

export interface RenameState {
  status: RenameStatus
  targetId: string | null
  value: string
}

export type RenameAction =
  | { type: 'start'; targetId: string; value: string }
  | { type: 'change'; value: string }
  | { type: 'submit' }
  | { type: 'succeed' }
  | { type: 'fail' }
  | { type: 'cancel' }

export const INITIAL_RENAME_STATE: RenameState = {
  status: 'idle',
  targetId: null,
  value: '',
}

export function isRenameTargetActive(state: RenameState, targetId: string): boolean {
  return state.targetId === targetId
    && (state.status === 'editing' || state.status === 'submitting' || state.status === 'failed')
}

export function renameStateReducer(state: RenameState, action: RenameAction): RenameState {
  switch (action.type) {
    case 'start':
      return state.status === 'submitting'
        ? state
        : { status: 'editing', targetId: action.targetId, value: action.value }
    case 'change':
      return state.status === 'editing' || state.status === 'failed'
        ? { ...state, status: 'editing', value: action.value }
        : state
    case 'submit':
      return state.status === 'editing' || state.status === 'failed'
        ? { ...state, status: 'submitting' }
        : state
    case 'succeed':
      return state.status === 'submitting' ? { ...state, status: 'success' } : state
    case 'fail':
      return state.status === 'editing' || state.status === 'submitting' || state.status === 'failed'
        ? { ...state, status: 'failed' }
        : state
    case 'cancel':
      return state.status === 'editing' || state.status === 'failed'
        ? { ...state, status: 'cancelled' }
        : state
  }
}
