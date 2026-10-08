import type { AiProvider, AiConfig, ChatProtocol, EmbeddingConfig, ProviderId, ValidateResult } from './types'
import type { AiServiceStatus } from '../../stores/appStore'
import { AiConfigError } from './errors'
import { OpenAICompatibleProvider } from './providers/openaiCompatible'
import { normalizeRequestTimeoutMs } from '@/services/requestTimeout'
import { getSearchConfig, testWebSearchConnection } from '../webSearch'
import { hasApiCredential } from '@/services/apiConnection'

let currentProvider: AiProvider | null = null
let currentConfig: AiConfig | null = null

let embeddingProvider: AiProvider | null = null
let embeddingConfig: EmbeddingConfig | null = null

export interface ChatProtocolCapabilities {
  label: string
  implemented: boolean
  chat: boolean
  streaming: boolean
  toolCalling: boolean
  embeddingProtocol: 'openai-embedding' | null
  reasoning: 'adapter-with-request-fallback' | false
  modelList: boolean
  localApi: boolean
  originAuthorization: boolean
  unsupportedReason?: string
}

/** 设置展示与运行时校验共用的协议能力矩阵。 */
export const CHAT_PROTOCOL_CAPABILITIES: Record<ChatProtocol, ChatProtocolCapabilities> = {
  'openai-chat': {
    label: 'OpenAI Chat Completions',
    implemented: true,
    chat: true,
    streaming: true,
    toolCalling: true,
    embeddingProtocol: 'openai-embedding',
    reasoning: 'adapter-with-request-fallback',
    modelList: true,
    localApi: true,
    originAuthorization: true,
  },
  'anthropic-messages': {
    label: 'Anthropic Messages',
    implemented: false,
    chat: false,
    streaming: false,
    toolCalling: false,
    embeddingProtocol: null,
    reasoning: false,
    modelList: false,
    localApi: false,
    originAuthorization: false,
    unsupportedReason: 'Anthropic Messages 原生协议尚未实现，请改用供应商提供的 OpenAI Compatible 接口',
  },
  'openai-responses': {
    label: 'OpenAI Responses',
    implemented: false,
    chat: false,
    streaming: false,
    toolCalling: false,
    embeddingProtocol: null,
    reasoning: false,
    modelList: false,
    localApi: false,
    originAuthorization: false,
    unsupportedReason: 'OpenAI Responses 原生协议尚未实现，请使用 OpenAI Chat Completions',
  },
}

export const SUPPORTED_CHAT_PROTOCOLS = (Object.keys(CHAT_PROTOCOL_CAPABILITIES) as ChatProtocol[])
  .filter((protocol) => CHAT_PROTOCOL_CAPABILITIES[protocol].implemented)

export function getChatProtocolCapabilities(protocol: ChatProtocol): ChatProtocolCapabilities {
  return CHAT_PROTOCOL_CAPABILITIES[protocol] || {
    label: String(protocol),
    implemented: false,
    chat: false,
    streaming: false,
    toolCalling: false,
    embeddingProtocol: null,
    reasoning: false,
    modelList: false,
    localApi: false,
    originAuthorization: false,
    unsupportedReason: `不支持的协议类型: ${String(protocol)}`,
  }
}

/** 判断是否为本地 API（Ollama 等），本地 API 不需要 API Key */
export function isLocalApi(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    )
  } catch {
    return false
  }
}

/** 根据协议类型创建对话 Provider */
export function createChatProvider(config: AiConfig): AiProvider {
  const capabilities = getChatProtocolCapabilities(config.protocol)
  if (!capabilities.implemented) {
    throw new AiConfigError(capabilities.unsupportedReason || `不支持的协议类型: ${config.protocol}`)
  }

  switch (config.protocol) {
    case 'openai-chat':
      return new OpenAICompatibleProvider(config)
    default:
      throw new AiConfigError(`不支持的协议类型: ${(config as AiConfig).protocol}`)
  }
}

/** 从 baseUrl 推断供应商标识（用于旧配置迁移） */
export function inferProvider(baseUrl: string): ProviderId {
  if (!baseUrl) return 'custom'
  const url = baseUrl.toLowerCase()
  if (url.includes('api.openai.com')) return 'openai'
  if (url.includes('api.deepseek.com')) return 'deepseek'
  if (url.includes('api.siliconflow.cn')) return 'siliconflow'
  if (url.includes('bigmodel.cn')) return 'zhipu'
  if (url.includes('xiaomimimo.com')) return 'mimo'
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1') || url.includes('ollama')) return 'ollama'
  if (url.includes('dashscope') || url.includes('coding')) return 'coding-plan'
  if (url.includes('anthropic') || url.includes('api.anthropic')) return 'anthropic'
  return 'custom'
}

export function initAiClient(config: AiConfig): AiProvider {
  if (!hasApiCredential(config) && !isLocalApi(config.baseUrl)) {
    throw new AiConfigError('API Key is required')
  }
  if (!config.baseUrl) {
    throw new AiConfigError('Base URL is required')
  }
  if (!config.chatModel) {
    throw new AiConfigError('Chat model name is required')
  }

  const effectiveConfig = { ...config, apiKey: '', embedding: { ...config.embedding, apiKey: '' }, timeout: normalizeRequestTimeoutMs(config.timeout) }
  currentConfig = effectiveConfig
  currentProvider = createChatProvider(effectiveConfig)
  return currentProvider
}

export function getAiClient(): AiProvider {
  if (!currentProvider) {
    throw new AiConfigError('AI client not initialized. Call initAiClient first.')
  }
  return currentProvider
}

export function getAiConfig(): AiConfig | null {
  return currentConfig
}

export function isAiReady(): boolean {
  return currentProvider !== null
}

export function initEmbeddingClient(config: EmbeddingConfig): AiProvider {
  if (!hasApiCredential(config) && !isLocalApi(config.baseUrl)) {
    throw new AiConfigError('Embedding API Key is required')
  }
  if (!config.baseUrl) {
    throw new AiConfigError('Embedding Base URL is required')
  }
  if (!config.embeddingModel) {
    throw new AiConfigError('Embedding model name is required')
  }

  const effectiveEmbeddingConfig = { ...config, apiKey: '', timeout: normalizeRequestTimeoutMs(config.timeout) }
  embeddingConfig = effectiveEmbeddingConfig
  const fullConfig: AiConfig = {
    protocol: 'openai-chat',
    provider: config.provider || 'custom',
    baseUrl: config.baseUrl.replace(/\/embeddings\/?$/, '').replace(/\/+$/, ''),
    apiKey: '',
    apiKeyConfigured: config.apiKeyConfigured,
    credentialVersion: config.credentialVersion,
    chatModel: config.embeddingModel,
    streamEnabled: false,
    webSearchEnabled: false,
    customPreferencePrompt: '',
    timeout: effectiveEmbeddingConfig.timeout,
    maxContextLength: 8192,
    temperature: 0,
    topP: 1,
    embedding: effectiveEmbeddingConfig,
  }
  embeddingProvider = new OpenAICompatibleProvider(fullConfig, 'embedding')
  return embeddingProvider
}

export function getEmbeddingClient(): AiProvider {
  if (!embeddingProvider) {
    throw new AiConfigError('Embedding client not initialized. Configure embedding API first.')
  }
  return embeddingProvider
}

export function isEmbeddingReady(): boolean {
  return embeddingProvider !== null
}

export function getEmbeddingConfig(): EmbeddingConfig | null {
  return embeddingConfig
}

/** 校验对话、Embedding 和联网搜索服务连通性，返回具体状态 */
export async function validateAiStatus(): Promise<AiServiceStatus> {
  const chatReady = currentProvider !== null
  const embReady = embeddingProvider !== null

  if (!chatReady && !embReady) return 'not_configured'

  const searchCfg = getSearchConfig()
  const searchNeedsCheck = searchCfg.provider !== 'custom'

  const [chatResult, embResult, searchOk] = await Promise.all([
    chatReady ? currentProvider!.validateConfig().then(r => r.ok).catch(() => false) : false,
    embReady ? embeddingProvider!.validateConfig().then(r => r.ok).catch(() => false) : false,
    searchNeedsCheck ? testWebSearchConnection(searchCfg).then(result => result.ok) : true,
  ])

  if (chatResult && embResult && searchOk) return 'ok'
  if (!chatResult && !embResult && !searchOk) return 'all_unreachable'
  if (!chatResult && !embResult) return 'both_unreachable'
  if (!chatResult && !searchOk) return 'chat_search_unreachable'
  if (!embResult && !searchOk) return 'embedding_search_unreachable'
  if (!chatResult) return 'chat_unreachable'
  if (!embResult) return 'embedding_unreachable'
  return 'search_unreachable'
}

/** 独立测试连接（不影响全局客户端状态），返回详细 ValidateResult */
export async function testAiConnection(config: AiConfig): Promise<ValidateResult> {
  const provider = createChatProvider(config)
  return provider.validateConfig()
}


export function resetAiClient(kind: 'chat' | 'embedding'): void {
  if (kind === 'chat') { currentProvider = null; currentConfig = null }
  else { embeddingProvider = null; embeddingConfig = null }
}
