import { OpenAICompatibleProvider } from '../src/services/ai/providers/openaiCompatible'
import { OpenAIResponsesProvider } from '../src/services/ai/providers/openaiResponses'
import {
  CHAT_PROTOCOL_CAPABILITIES,
  SUPPORTED_CHAT_PROTOCOLS,
  createChatProvider,
  getChatProtocolCapabilities,
} from '../src/services/ai/aiClient'
import { updateSearchConfig, webSearch } from '../src/services/webSearch'
import { AI_CHAT_PRESETS, AI_EMBEDDING_PRESETS, type AiConfig } from '../src/services/ai/types'
import { readFileSync } from 'node:fs'
import {
  ExternalHttpError,
  externalFetch,
  listAuthorizedApiOrigins,
  setOriginAuthorizationPrompt,
} from '../src/services/externalHttp'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const runtime = globalThis as typeof globalThis & {
  __TEST_TAURI__?: boolean
  __TAURI_INVOKE__?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}

runtime.__TEST_TAURI__ = true
globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }

const builtinOrigins = new Set([
  'https://ark.cn-beijing.volces.com:443',
  'https://api.openai.com:443',
  'https://api.tavily.com:443',
  'https://api.github.com:443',
])
const sessionOrigins = new Set<string>()
const persistedOrigins = new Set<string>()
const requests: Array<{ url: string; method: string; headers: [string, string][]; body?: number[] }> = []
let rejectedReasoningRequests = 0

function originOf(value: string) {
  const url = new URL(value)
  return `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
}

function nativeError(code: string, message: string, origin?: string) {
  return { code, message, origin }
}

function authorize(origin: string) {
  const url = new URL(origin)
  if (url.hostname === '169.254.169.254' || url.hostname === '0.0.0.0' || url.hostname.startsWith('224.')) {
    throw nativeError('ADDRESS_NOT_ALLOWED', '目标地址属于永久禁止访问的网络范围')
  }
  const privateHttp = url.protocol === 'http:' && (
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' ||
    url.hostname.startsWith('10.') || url.hostname.startsWith('192.168.')
  )
  if (url.protocol === 'http:' && !privateHttp) {
    throw nativeError('PUBLIC_HTTP_NOT_ALLOWED', '公网 API 仅允许使用 HTTPS')
  }
}

function responseBody(url: string, body?: number[]) {
  const decoded = body ? new TextDecoder().decode(Uint8Array.from(body)) : ''
  if (url.includes('/responses') && decoded.includes('"stream":true')) {
    return [
      `event: response.output_item.added\ndata: ${JSON.stringify({
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: 'fc-item-1', type: 'function_call', call_id: 'call-1', name: 'get_weather', arguments: '' },
      })}\n\n`,
      `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc-item-1',
        delta: '{"city":"Beijing"}',
      })}\n\n`,
      `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: 'response.output_text.delta',
        output_index: 1,
        content_index: 0,
        delta: '流式',
      })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed' })}\n\n`,
    ].join('')
  }
  if (url.includes('/responses')) {
    return JSON.stringify({
      id: 'resp-1',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '完成' }],
        },
        {
          id: 'fc-item-1',
          type: 'function_call',
          call_id: 'call-1',
          name: 'get_weather',
          arguments: '{"city":"Beijing"}',
        },
      ],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    })
  }
  if (url.includes('/chat/completions') && decoded.includes('"stream":true')) {
    return 'data: {"choices":[{"delta":{"content":"流式"}}]}\n\ndata: [DONE]\n\n'
  }
  if (url.includes('/chat/completions')) {
    return JSON.stringify({ id: 'chat-1', choices: [{ message: { content: '完成' } }] })
  }
  if (url.includes('/embeddings')) {
    return JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { total_tokens: 2 } })
  }
  if (url.includes('/models')) {
    return JSON.stringify({ data: [{ id: 'glm-5.2' }] })
  }
  if (url.includes('api.tavily.com')) {
    return JSON.stringify({ results: [{ title: '结果', url: 'https://example.com', content: '摘要' }] })
  }
  return JSON.stringify({ ok: true })
}

runtime.__TAURI_INVOKE__ = async (command, args = {}) => {
  if (command === 'authorize_api_origin') {
    const request = args.request as { origin: string; persistence: 'session' | 'permanent' }
    authorize(request.origin)
    ;(request.persistence === 'permanent' ? persistedOrigins : sessionOrigins).add(request.origin)
    return request.origin
  }
  if (command === 'list_authorized_api_origins') {
    return [
      ...Array.from(persistedOrigins, (origin) => ({ origin, persistence: 'permanent' })),
      ...Array.from(sessionOrigins, (origin) => ({ origin, persistence: 'session' })),
    ]
  }
  if (command === 'revoke_api_origin') {
    sessionOrigins.delete(args.origin as string)
    persistedOrigins.delete(args.origin as string)
    return
  }
  if (command !== 'external_http_stream') throw new Error(`unexpected command: ${command}`)

  const request = args.request as { url: string; method: string; headers: [string, string][]; body?: number[] }
  const channel = args.onEvent as { onmessage?: (event: unknown) => void }
  const origin = originOf(request.url)
  requests.push(request)
  queueMicrotask(() => {
    if (!builtinOrigins.has(origin) && !sessionOrigins.has(origin) && !persistedOrigins.has(origin)) {
      channel.onmessage?.({ event: 'error', error: nativeError('ORIGIN_NOT_AUTHORIZED', '未授权', origin) })
      return
    }
    if (request.url.endsWith('/redirect')) {
      channel.onmessage?.({ event: 'start', status: 302, headers: [['location', 'https://other.example/final']] })
      channel.onmessage?.({ event: 'end' })
      return
    }
    const decodedBody = request.body ? new TextDecoder().decode(Uint8Array.from(request.body)) : ''
    if (request.url.includes('api.openai.com') && decodedBody.includes('"reasoning_effort"')) {
      rejectedReasoningRequests += 1
      const encoded = new TextEncoder().encode(JSON.stringify({ error: 'unsupported reasoning parameter' }))
      channel.onmessage?.({ event: 'start', status: 400, headers: [['content-type', 'application/json']] })
      channel.onmessage?.({ event: 'chunk', data: Array.from(encoded) })
      channel.onmessage?.({ event: 'end' })
      return
    }
    const encoded = new TextEncoder().encode(responseBody(request.url, request.body))
    channel.onmessage?.({ event: 'start', status: 200, headers: [['content-type', 'application/json']] })
    channel.onmessage?.({ event: 'chunk', data: Array.from(encoded) })
    channel.onmessage?.({ event: 'end' })
  })
}

const config: AiConfig = {
  protocol: 'openai-chat',
  provider: 'coding-plan',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  apiKey: 'test',
  chatModel: 'glm-5.2',
  streamEnabled: true,
  webSearchEnabled: false,
  customPreferencePrompt: '',
  timeout: 15000,
  maxContextLength: 8192,
  temperature: 0.7,
  topP: 1,
  embedding: {
    protocol: 'openai-embedding', provider: 'custom', baseUrl: '', apiKey: '', embeddingModel: 'embed',
  },
}

const provider = new OpenAICompatibleProvider(config)
const rustProxySource = readFileSync('src-tauri/src/api_http.rs', 'utf8')
assert(
  SUPPORTED_CHAT_PROTOCOLS.length === 2
    && SUPPORTED_CHAT_PROTOCOLS.includes('openai-chat')
    && SUPPORTED_CHAT_PROTOCOLS.includes('openai-responses'),
  '设置页只能展示已实现的 OpenAI Chat Completions 和 Responses 协议',
)
assert(
  !getChatProtocolCapabilities('unknown' as never).implemented &&
    getChatProtocolCapabilities('unknown' as never).unsupportedReason === '不支持的协议类型: unknown',
  '未知协议应在发起请求前稳定拒绝，不得导致设置页崩溃',
)
assert(
  CHAT_PROTOCOL_CAPABILITIES['openai-chat'].streaming &&
    CHAT_PROTOCOL_CAPABILITIES['openai-chat'].toolCalling &&
    CHAT_PROTOCOL_CAPABILITIES['openai-chat'].embeddingProtocol === 'openai-embedding' &&
    CHAT_PROTOCOL_CAPABILITIES['openai-chat'].modelList &&
    CHAT_PROTOCOL_CAPABILITIES['openai-chat'].localApi &&
    CHAT_PROTOCOL_CAPABILITIES['openai-chat'].originAuthorization,
  'OpenAI Compatible 能力矩阵应覆盖流式、工具、Embedding、模型列表、本地 API 与 Origin 授权',
)
assert(
  CHAT_PROTOCOL_CAPABILITIES['openai-responses'].implemented &&
    CHAT_PROTOCOL_CAPABILITIES['openai-responses'].streaming &&
    CHAT_PROTOCOL_CAPABILITIES['openai-responses'].toolCalling &&
    CHAT_PROTOCOL_CAPABILITIES['openai-responses'].modelList &&
    CHAT_PROTOCOL_CAPABILITIES['openai-responses'].localApi &&
    CHAT_PROTOCOL_CAPABILITIES['openai-responses'].originAuthorization,
  'OpenAI Responses 能力矩阵应覆盖已实现的对话、流式、工具、模型列表、本地 API 与 Origin 授权',
)
for (const protocol of ['anthropic-messages'] as const) {
  let message = ''
  try {
    createChatProvider({ ...config, protocol })
  } catch (error) {
    message = (error as Error).message
  }
  assert(
    !CHAT_PROTOCOL_CAPABILITIES[protocol].implemented && message.includes('尚未实现'),
    `${CHAT_PROTOCOL_CAPABILITIES[protocol].label} 应在发起请求前给出准确拒绝原因`,
  )
}
for (const preset of [...AI_CHAT_PRESETS, ...AI_EMBEDDING_PRESETS]) {
  if (!preset.baseUrl) continue
  const origin = originOf(preset.baseUrl)
  assert(rustProxySource.includes(`"${origin}"`), `内置供应商 Origin 未加入 Rust 白名单：${origin}`)
}
const validation = await provider.validateConfig()
assert(validation.ok && validation.models?.[0] === 'glm-5.2', '内置火山供应商连接测试和模型列表应自动放行')

const chat = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
assert(chat.content === '完成', '非流式对话应经过 Rust 代理')

let streamed = ''
for await (const chunk of provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] })) streamed += chunk.content
assert(streamed === '流式', '流式对话应通过 Channel 保持 SSE 解析')

const reasoningProvider = new OpenAICompatibleProvider({
  ...config,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  chatModel: 'gpt-4o-mini',
})
const reasoningStart = requests.length
const reasoningChat = await reasoningProvider.chat({
  messages: [{ role: 'user', content: 'hi' }],
  reasoningMode: 'on',
})
assert(reasoningChat.content === '完成', 'Reasoning 参数被拒绝后，非流式请求应移除参数并重试')
let reasoningStreamed = ''
for await (const chunk of reasoningProvider.streamChat({
  messages: [{ role: 'user', content: 'hi' }],
  reasoningMode: 'on',
})) reasoningStreamed += chunk.content
assert(reasoningStreamed === '流式', 'Reasoning 参数被拒绝后，流式请求应移除参数并重试')
const reasoningBodies = requests.slice(reasoningStart).map((request) =>
  request.body ? new TextDecoder().decode(Uint8Array.from(request.body)) : ''
)
assert(
  rejectedReasoningRequests === 2 &&
    reasoningBodies.length === 4 &&
    reasoningBodies[0].includes('"reasoning_effort":"medium"') &&
    !reasoningBodies[1].includes('"reasoning_effort"') &&
    reasoningBodies[2].includes('"reasoning_effort":"medium"') &&
    !reasoningBodies[3].includes('"reasoning_effort"'),
  'Reasoning 探测与降级必须由真实 400 响应触发，且重试请求不得保留 reasoning 参数',
)

const embedding = await provider.embedding('test')
assert(embedding.embedding.length === 2, 'Embedding 应经过 Rust 代理')
assert((await provider.listModels())[0] === 'glm-5.2', '模型列表应经过 Rust 代理')

const responsesConfig: AiConfig = {
  ...config,
  protocol: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  chatModel: 'gpt-4o-mini',
}
const responsesProvider = new OpenAIResponsesProvider(responsesConfig)
assert(createChatProvider(responsesConfig) instanceof OpenAIResponsesProvider, 'Responses 协议应创建专用 Provider')

const responseTools = [{
  type: 'function' as const,
  function: {
    name: 'get_weather',
    description: '获取天气',
    parameters: {
      type: 'object' as const,
      properties: { city: { type: 'string', description: '城市' } },
      required: ['city'],
    },
  },
}]
const responseChat = await responsesProvider.chat({
  messages: [
    { role: 'system', content: '你是一个有帮助的助手。' },
    { role: 'user', content: '北京天气如何？' },
  ],
  maxTokens: 12,
  tools: responseTools,
  toolChoice: 'auto',
})
assert(responseChat.content === '完成', 'Responses 非流式输出应读取 output_text')
assert(responseChat.toolCalls?.[0]?.name === 'get_weather', 'Responses 非流式输出应读取 function_call')
assert(responseChat.toolCalls?.[0]?.args.city === 'Beijing', 'Responses 工具参数应解析为对象')
assert(responseChat.usage?.totalTokens === 5, 'Responses 用量应映射为统一格式')

const responseRequest = requests.find((request) => request.url.endsWith('/responses') && !new TextDecoder().decode(Uint8Array.from(request.body)).includes('"stream":true'))
assert(responseRequest, 'Responses 对话应请求 /responses')
const responsePayload = JSON.parse(new TextDecoder().decode(Uint8Array.from(responseRequest.body || []))) as Record<string, unknown>
assert(responsePayload.store === false, 'Responses 请求不得默认存储用户内容')
assert(responsePayload.max_output_tokens === 12, 'Responses 请求应映射 max_output_tokens')
assert(
  Array.isArray(responsePayload.input)
  && responsePayload.input[0]?.role === 'system'
  && responsePayload.input[1]?.content === '北京天气如何？',
  'Responses 请求应保留对话角色和内容',
)
assert(
  Array.isArray(responsePayload.tools)
  && responsePayload.tools[0]?.name === 'get_weather'
  && !('function' in responsePayload.tools[0]),
  'Responses 工具定义应使用扁平 function schema',
)

let responsesStreamed = ''
const streamedToolCall = { name: '', arguments: '' }
for await (const chunk of responsesProvider.streamChat({
  messages: [{ role: 'user', content: '北京天气如何？' }],
  tools: responseTools,
  toolChoice: 'auto',
})) {
  responsesStreamed += chunk.content
  for (const delta of chunk.toolCallDeltas || []) {
    streamedToolCall.name += delta.name || ''
    streamedToolCall.arguments += delta.arguments || ''
  }
}
assert(responsesStreamed === '流式', 'Responses 流式输出应读取 output_text delta')
assert(streamedToolCall.name === 'get_weather', 'Responses 流式输出应读取 function_call 名称')
assert(streamedToolCall.arguments === '{"city":"Beijing"}', 'Responses 流式输出应读取 function_call 参数')

updateSearchConfig({ provider: 'tavily', apiKey: 'test', maxResults: 1 })
assert((await webSearch('test')).results.length === 1, '联网搜索应经过 Rust 代理')

const NativeRequest = globalThis.Request
class ChromiumRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.delete('user-agent')
    super(input, { ...init, headers })
  }
}
Object.defineProperty(globalThis, 'Request', { value: ChromiumRequest, configurable: true })
try {
  await externalFetch('https://api.github.com/repos/we-used-to-be/Guanmo-open/releases/latest', {
    headers: { 'User-Agent': 'Guanmo-Update-Checker' },
  })
} finally {
  Object.defineProperty(globalThis, 'Request', { value: NativeRequest, configurable: true })
}
assert(
  requests.at(-1)?.headers.some(([name, value]) => name === 'user-agent' && value === 'Guanmo-Update-Checker'),
  'Chromium 剥离 Request 的 User-Agent 后，Rust 请求仍应收到调用方显式请求头',
)

let promptCount = 0
const restoreCancelPrompt = setOriginAuthorizationPrompt(async () => 'cancel')
let unauthorizedCode = ''
try { await externalFetch('https://custom.example/v1/models') } catch (error) { unauthorizedCode = (error as ExternalHttpError).code }
restoreCancelPrompt()
assert(unauthorizedCode === 'ORIGIN_NOT_AUTHORIZED', '自定义 HTTPS 首次请求应返回 ORIGIN_NOT_AUTHORIZED，拒绝后不得中断应用')

let cancelledValidationPrompts = 0
const restoreValidationCancel = setOriginAuthorizationPrompt(async () => {
  cancelledValidationPrompts += 1
  return 'cancel'
})
const customProvider = new OpenAICompatibleProvider({ ...config, provider: 'custom', baseUrl: 'https://cancelled.example/v1' })
try { await customProvider.validateConfig() } catch { /* expected */ }
restoreValidationCancel()
assert(cancelledValidationPrompts === 1, '连接测试拒绝授权后不得回退请求并重复弹窗')

const restorePrompt = setOriginAuthorizationPrompt(async () => {
  promptCount += 1
  return 'permanent'
})
await externalFetch('https://custom.example/v1/models')
assert(promptCount === 1 && persistedOrigins.has('https://custom.example:443'), '自定义 HTTPS 应在确认后永久授权')
sessionOrigins.clear()
await externalFetch('https://custom.example/v1/models')
assert(promptCount === 1, '永久授权应在模拟重启后继续生效')
assert((await listAuthorizedApiOrigins()).some((item) => item.origin === 'https://custom.example:443'), '设置页应能读取永久授权')
restorePrompt()

const restoreSessionPrompt = setOriginAuthorizationPrompt(async () => 'session')
await externalFetch('http://localhost:11435/v1/models')
await externalFetch('http://192.168.1.20:11434/v1/models')
assert(sessionOrigins.has('http://localhost:11435') && sessionOrigins.has('http://192.168.1.20:11434'), 'localhost 和私网 HTTP 应仅在用户授权后放行')
restoreSessionPrompt()

for (const [url, code] of [
  ['http://example.com/v1', 'PUBLIC_HTTP_NOT_ALLOWED'],
  ['http://169.254.169.254/latest/meta-data', 'ADDRESS_NOT_ALLOWED'],
  ['http://0.0.0.0/v1', 'ADDRESS_NOT_ALLOWED'],
] as const) {
  const restore = setOriginAuthorizationPrompt(async () => 'session')
  let actual = ''
  try { await externalFetch(url) } catch (error) { actual = (error as ExternalHttpError).code }
  restore()
  assert(actual === code, `${url} 应被 Rust 授权边界拒绝`)
}

const redirect = await externalFetch('https://custom.example/redirect')
assert(redirect.status === 302 && !requests.some((item) => item.url === 'https://other.example/final'), '跨 Origin 重定向不得自动跟随')

runtime.__TEST_TAURI__ = false
for (const action of [
  () => provider.validateConfig(),
  () => provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
  () => webSearch('test'),
]) {
  let unsupported = false
  try { await action() } catch (error) { unsupported = (error as Error).name === 'UnsupportedCapabilityError' }
  assert(unsupported, 'Web 版 AI、搜索和连接测试必须拒绝外部请求')
}

console.info('AI HTTP transport checks passed')
