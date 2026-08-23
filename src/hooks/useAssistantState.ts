import { useSyncExternalStore } from 'react'
import {
  getAssistantState,
  subscribeAssistantState,
  type AssistantState,
} from '@/services/assistantState'

/** 订阅 AI 助手角色状态；仅在状态变化时触发重渲染。 */
export function useAssistantState(): AssistantState {
  return useSyncExternalStore(subscribeAssistantState, getAssistantState, getAssistantState)
}
