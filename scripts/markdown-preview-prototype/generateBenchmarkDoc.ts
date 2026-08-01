/**
 * 阶段2原型：匿名 Markdown 样本生成器
 *
 * 生成仅包含结构化模板与无意义填充文本的大文档，
 * 不读取真实用户数据，可用于 A/B 基准。
 */

export interface BenchmarkDoc {
  name: string
  targetChars: number
  markdown: string
  actualChars: number
}

const CHINESE_WORDS = [
  '样本', '数据', '观察', '结论', '测试', '记录', '验证', '基准',
  '段落', '章节', '标题', '说明', '描述', '分析', '比较', '结果',
  '指标', '阈值', '范围', '条件', '场景', '入口', '模式', '状态',
]

const ENGLISH_WORDS = [
  'sample', 'benchmark', 'verify', 'record', 'result', 'metric',
  'baseline', 'section', 'chapter', 'paragraph', 'summary', 'report',
  'analysis', 'compare', 'threshold', 'scenario', 'workflow', 'model',
]

function rand(seed: number) {
  // xorshift32，确定性行为，便于同一字符目标的每次生成结果稳定
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function sentenceCN(rng: () => number, length = 14): string {
  const parts: string[] = []
  for (let i = 0; i < length; i += 1) parts.push(pick(rng, CHINESE_WORDS))
  return parts.join('，') + '。'
}

function sentenceEN(rng: () => number, length = 8): string {
  const parts: string[] = []
  for (let i = 0; i < length; i += 1) parts.push(pick(rng, ENGLISH_WORDS))
  const s = parts.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

function codeSnippet(rng: () => number, lines: number): string {
  const header = `// Anonymous benchmark function r=${rng().toFixed(4)}\n`
  const body: string[] = []
  for (let i = 0; i < lines; i += 1) {
    const n = Math.floor(rng() * 8)
    body.push('  '.repeat(Math.min(4, n % 4)) + `const v${i % 100} = ${Math.floor(rng() * 9999)};`)
  }
  return header + body.join('\n')
}

function tableRows(rng: () => number, rows: number): string {
  const header = '| 编号 | 项目 | 说明 | 结果 |\n| --- | --- | --- | --- |\n'
  const rows_: string[] = []
  for (let i = 0; i < rows; i += 1) {
    const a = pick(rng, CHINESE_WORDS) + pick(rng, ENGLISH_WORDS)
    const b = sentenceCN(rng, 6)
    const c = rng() > 0.5 ? 'PASS' : 'SKIP'
    rows_.push(`| ${i + 1} | ${a} | ${b} | ${c} |`)
  }
  return header + rows_.join('\n')
}

export function generateAnonymousMarkdown(targetChars: number, seed = 42): BenchmarkDoc {
  const rng = rand(seed + targetChars)
  const chunks: string[] = []
  chunks.push('---\ntitle: Anonymous Benchmark\nversion: 0.0.0\ntags: [benchmark, anonymous]\n---\n\n')

  let chapter = 1
  let chars = chunks[0].length

  while (chars < targetChars) {
    const titleCN = sentenceCN(rng, 4).replace(/。$/, '')
    chunks.push(`# 第${chapter}章 ${titleCN}\n\n`)
    chars += chunks[chunks.length - 1].length
    chapter += 1

    // 每个章下 3~6 个小节
    const sections = 3 + Math.floor(rng() * 4)
    for (let s = 1; s <= sections && chars < targetChars; s += 1) {
      const subTitle = sentenceCN(rng, 3).replace(/。$/, '')
      chunks.push(`## ${chapter - 1}.${s} ${subTitle}\n\n`)
      chars += chunks[chunks.length - 1].length

      // 普通段落（中文 + 英文混合）
      for (let p = 0; p < 2 && chars < targetChars; p += 1) {
        const para = sentenceCN(rng, 18) + ' ' + sentenceEN(rng, 12) + ' ' + sentenceCN(rng, 12) + '\n\n'
        chunks.push(para)
        chars += para.length
      }

      // 每隔几个小节插入表格/列表/代码/数学/引用
      const flavor = Math.floor(rng() * 5)
      if (flavor === 0 && chars < targetChars) {
        const table = tableRows(rng, 4 + Math.floor(rng() * 4)) + '\n\n'
        chunks.push(table)
        chars += table.length
      } else if (flavor === 1 && chars < targetChars) {
        const items = 5 + Math.floor(rng() * 5)
        const lines: string[] = []
        for (let i = 0; i < items; i += 1) {
          const checked = rng() > 0.5 ? 'x' : ' '
          lines.push(`- [${checked}] ${sentenceCN(rng, 8)}`)
          if (rng() > 0.6) {
            lines.push(`  - ${sentenceEN(rng, 6)}`)
            if (rng() > 0.7) lines.push(`    1. ${sentenceCN(rng, 6)}`)
          }
        }
        const list = lines.join('\n') + '\n\n'
        chunks.push(list)
        chars += list.length
      } else if (flavor === 2 && chars < targetChars) {
        const lines = 8 + Math.floor(rng() * 10)
        const code = '```typescript\n' + codeSnippet(rng, lines) + '\n```\n\n'
        chunks.push(code)
        chars += code.length
      } else if (flavor === 3 && chars < targetChars) {
        const math =
          '公式：$E = mc^2$，以及：\n\n$$\n\\int_{a}^{b} x^2 \\, dx = \\frac{b^3 - a^3}{3}\n$$\n\n'
        chunks.push(math)
        chars += math.length
      } else if (chars < targetChars) {
        const quote = `> ${sentenceCN(rng, 12)}\n> ${sentenceEN(rng, 10)}\n\n`
        chunks.push(quote)
        chars += quote.length
      }
    }
  }

  const markdown = chunks.join('')
  return {
    name: `${targetChars >= 1_000_000 ? '1M' : targetChars >= 500_000 ? '500K' : targetChars >= 200_000 ? '200K' : '50K'}`,
    targetChars,
    markdown,
    actualChars: markdown.length,
  }
}

export const BENCHMARK_SIZES = [
  { key: '50K', chars: 50_000 },
  { key: '200K', chars: 200_000 },
  { key: '500K', chars: 500_000 },
  { key: '1M', chars: 1_000_000 },
] as const
