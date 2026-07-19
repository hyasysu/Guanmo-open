import type { EditConfirmation } from '@/services/ai/types'
import type { AgentProgressStage, AgentStep } from './types'

type PendingEditPayload = Omit<EditConfirmation, 'id' | 'messageId' | 'status'>

export type AgentSessionEvent =
  | { type: 'thought'; step: AgentStep }
  | { type: 'action'; step: AgentStep; toolName?: string }
  | { type: 'observation'; step: AgentStep; toolName?: string; pendingEdit?: PendingEditPayload }
  | { type: 'progress'; step: AgentStep; stage: AgentProgressStage }

export interface AgentSessionState {
  steps: AgentStep[]
  pendingEdits: PendingEditPayload[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function decodePendingEdit(value: unknown): PendingEditPayload | undefined {
  if (!isRecord(value) || value.__pendingEdit !== true) return undefined
  if (
    typeof value.oldText !== 'string'
    || typeof value.newText !== 'string'
    || typeof value.tabId !== 'string'
    || typeof value.tabTitle !== 'string'
  ) return undefined

  return {
    oldText: value.oldText,
    newText: value.newText,
    tabId: value.tabId,
    tabTitle: value.tabTitle,
    replaceFrom: optionalNumber(value.replaceFrom),
    replaceTo: optionalNumber(value.replaceTo),
    replaceWholeDocument: typeof value.replaceWholeDocument === 'boolean' ? value.replaceWholeDocument : undefined,
    changeSummary: typeof value.changeSummary === 'string' ? value.changeSummary : undefined,
    selectionFrom: optionalNumber(value.selectionFrom),
    selectionTo: optionalNumber(value.selectionTo),
  }
}

export function decodeAgentStepEvent(step: AgentStep): AgentSessionEvent {
  if (step.type === 'progress') {
    const stages: AgentProgressStage[] = ['rag_initializing', 'rag_ready', 'rag_searching', 'rag_fallback']
    if (!step.progressStage || !stages.includes(step.progressStage)) {
      throw new Error('Agent progress event is invalid')
    }
    return { type: 'progress', step, stage: step.progressStage }
  }
  if (step.type === 'thought') return { type: 'thought', step }
  if (step.type === 'action') return { type: 'action', step, toolName: step.toolName }

  let pendingEdit: PendingEditPayload | undefined
  try {
    pendingEdit = decodePendingEdit(JSON.parse(step.content))
  } catch {
    pendingEdit = undefined
  }
  return { type: 'observation', step, toolName: step.toolName, pendingEdit }
}

export function decodeKnowledgeSearchOutcome(
  event: AgentSessionEvent,
): 'found' | 'empty' | 'error' | undefined {
  if (event.type !== 'observation' || event.toolName !== 'search_knowledge') return undefined
  try {
    const parsed = JSON.parse(event.step.content)
    if (!isRecord(parsed)) return 'error'
    if (parsed.status === 'ok' && Array.isArray(parsed.results) && parsed.results.length > 0) return 'found'
    if (parsed.status === 'empty' && Array.isArray(parsed.results) && parsed.results.length === 0) return 'empty'
    return 'error'
  } catch {
    return 'error'
  }
}

export function reduceAgentSession(state: AgentSessionState, event: AgentSessionEvent): AgentSessionState {
  return {
    steps: [...state.steps, event.step],
    pendingEdits: event.type === 'observation' && event.pendingEdit
      ? [...state.pendingEdits, event.pendingEdit]
      : state.pendingEdits,
  }
}
