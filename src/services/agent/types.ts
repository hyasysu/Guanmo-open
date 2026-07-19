import type { ChatMessage, ChatMessageSource } from '@/services/ai/types'
import type { Capability } from './intentDetector'

export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean'
  description: string
  required: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: ToolParameter[]
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string>
}

export type AgentProgressStage =
  | 'rag_initializing'
  | 'rag_ready'
  | 'rag_searching'
  | 'rag_fallback'

export interface ToolExecutionContext {
  signal?: AbortSignal
  onProgress?: (stage: AgentProgressStage) => void
}

export interface AgentStep {
  type: 'thought' | 'action' | 'observation' | 'progress'
  content: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  timestamp: number
  progressStage?: AgentProgressStage
}

export type AgentResultReason = 'completed' | 'max_steps' | 'error'

export interface AgentResult {
  answer: string
  steps: AgentStep[]
  toolCalls: number
  reason: AgentResultReason
  finalMessages?: ChatMessage[]
  sources?: ChatMessageSource[]
}

export interface AgentConfig {
  maxSteps: number
  stepTimeout: number
  systemPrompt: string
}

export interface AgentRunRequest {
  query: string
  chatHistory?: ChatMessage[]
  config?: Partial<AgentConfig>
  rawQuery?: string
  hasRecentEditContext?: boolean
  hasCurrentEditTarget?: boolean
  currentEditTargetCount?: number
  candidateToolNames?: readonly string[]
  hasPrefetchedMemoryLookup?: boolean
  signal?: AbortSignal
  temperature?: number
  onStep?: (step: AgentStep) => void
  requiredCapabilities?: readonly Capability[]
  untrustedContext?: string
  customPreferencePrompt?: string
  streamEnabled?: boolean
}
