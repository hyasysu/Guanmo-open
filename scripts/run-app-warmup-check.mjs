import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/App.tsx', 'utf8')
const singleton = readFileSync('src/services/singletonPromise.ts', 'utf8')
const appLayout = readFileSync('src/components/layout/AppLayout.tsx', 'utf8')
const aiPanel = readFileSync('src/components/ai/AiPanel.tsx', 'utf8')
const aiChat = readFileSync('src/hooks/useAiChat.ts', 'utf8')
const persistence = readFileSync('src/services/database/persistence.ts', 'utf8')

assert.doesNotMatch(app, /loadChatSessions|loadAllMemories/, 'App 不得执行结果被丢弃的查询')
assert.doesNotMatch(singleton, /CHAT_SESSIONS|MEMORIES/, '不得保留无消费者的 singleton')
assert.match(appLayout, /const AiPanel = lazy\(/, 'AI 面板必须保持懒加载')
assert.match(appLayout, /aiPanelOpen && \([\s\S]*<Suspense fallback=\{null\}><AiPanel/, '首次打开时才挂载 AI 面板')
assert.match(aiPanel, /const handleLoadHistory[\s\S]*await loadMoreHistory\(\)/, '历史记录由 AI 面板真实交互按需加载')
assert.match(aiChat, /singletonManager\.init\(SINGLETON_IDS\.CHAT_AI/, '聊天客户端预热结果必须由真实消费者复用')
assert.match(persistence, /export async function loadRecentChatTurns[\s\S]*const db = getDatabase\(\)/, '重连后的历史查询必须动态获取当前数据库 adapter')
assert.doesNotMatch(app, /subscribeDatabaseRuntimeState/, '数据库 ready 事件不得触发丢弃结果的查询')

console.log('app warmup checks passed')
