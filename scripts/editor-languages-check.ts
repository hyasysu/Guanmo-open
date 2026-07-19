import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LanguageDescription } from '@codemirror/language'
import { editorCodeLanguages } from '@/services/editorCodeLanguages'

for (const language of ['js', 'typescript', 'tsx', 'python', 'rust', 'sql', 'bash', 'powershell']) {
  assert.ok(
    LanguageDescription.matchLanguageName(editorCodeLanguages, language, true),
    `常用语言 ${language} 应有按需加载描述`
  )
}

assert.equal(
  LanguageDescription.matchLanguageName(editorCodeLanguages, 'unknown-language-for-plain-text-fallback', true),
  null,
  '未知语言必须不匹配解析器，由 Markdown 编辑器降级为纯文本'
)

const editorSource = readFileSync('src/components/editor/CodeMirrorEditor.tsx', 'utf8')
const viteSource = readFileSync('vite.config.ts', 'utf8')
assert.doesNotMatch(editorSource, /@codemirror\/language-data/, '编辑器不得重新预加载完整 language-data')
assert.doesNotMatch(viteSource, /@codemirror\/language-data/, '构建配置不得重新打包完整 language-data')
assert.match(editorSource, /codeLanguages: editorCodeLanguages/, 'Markdown 编辑器必须使用精简语言描述集合')

console.log('editor language loading checks passed')
