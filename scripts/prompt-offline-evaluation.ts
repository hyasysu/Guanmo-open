/**
 * 路由与 Prompt 离线评测 runner（PROMPT-01）。
 *
 * 口径（阶段 15 冻结）：
 * - 路由对象：makeRoutingDecision 全链路（intentDetector/toolSelector/session/memoryService 分类器）。
 * - Prompt 对象：systemPrompts 的 4 个系统段 + answerInstructions 的 4 个回答指令。
 * - 模型配置：固定 offline-deterministic 口径，不调用真实模型；A/B 对比强制同配置指纹。
 * - 指标：Direct/Agent 误判率、能力漏选/多选率、工具解析成功率、候选工具调用数、
 *   路由/Prompt 组装/工具解析延迟。
 * - 回归集：tests/agent/fixtures/promptEvaluation.json，全部为合成匿名文本，
 *   不读取用户数据、文件或数据库。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { makeRoutingDecision } from '../src/services/agent/routingService'
import type { Capability, AppContext } from '../src/services/agent/intentDetector'
import { parseToolCall } from '../src/services/agent/toolCallParser'
import { registerBuiltinTools } from '../src/services/agent/tools'
import { buildSystemMessages } from '../src/services/ai/systemPrompts'
import {
  getPromptVersionDescriptor,
  getEvaluationConfigFingerprint,
  comparePromptVariants,
  hashText,
  OFFLINE_DETERMINISTIC_CONFIG,
  type EvaluationConfig,
  type PromptVersionDescriptor,
} from '../src/services/ai/promptVersions'

interface ToolCallSample {
  responseText: string
  expectedToolName: string | null
  expectedArgs: Record<string, unknown> | null
}

interface RoutingFixtureCase {
  id: string
  category: string
  query: string
  appContext: AppContext
  expectedMode: 'direct' | 'agent'
  requiredCapabilities: Capability[]
  forbiddenCapabilities: Capability[]
  toolCallSample: ToolCallSample | null
}

interface EvaluationFixture {
  version: number
  config: EvaluationConfig
  routingProbes: Array<{ query: string; appContext: AppContext }>
  cases: RoutingFixtureCase[]
}

interface LatencyStats {
  p50: number
  p95: number
  max: number
}

interface DeterministicMetrics {
  totalCases: number
  expectedDirectCases: number
  expectedAgentCases: number
  directMisjudgments: number
  agentMisjudgments: number
  directMisjudgmentRate: number
  agentMisjudgmentRate: number
  capabilityMissRate: number
  capabilityOverReachRate: number
  toolParseSampleCount: number
  toolParseSuccesses: number
  toolParseSuccessRate: number
  avgCandidateTools: number
  mismatchCaseIds: string[]
  forbiddenViolationCaseIds: string[]
  routingBehaviorFingerprint: string
}

interface EvaluationReport {
  fixtureVersion: number
  promptDescriptor: PromptVersionDescriptor
  evaluationConfig: EvaluationConfig
  evaluationConfigFingerprint: string
  deterministic: DeterministicMetrics
  latencyMs: {
    routingDecision: LatencyStats
    promptAssembly: LatencyStats
    toolParse: LatencyStats
  }
  abCheck: {
    repeatable: boolean
    promptVariantDetectionWorks: boolean
    configMismatchRejected: boolean
  }
}

const fixturePath = resolve(process.cwd(), 'tests/agent/fixtures/promptEvaluation.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as EvaluationFixture

registerBuiltinTools()

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

function measureLatencies(iterations: number, fn: () => void): LatencyStats {
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const started = performance.now()
    fn()
    samples.push(performance.now() - started)
  }
  return {
    p50: Number(percentile(samples, 0.5).toFixed(3)),
    p95: Number(percentile(samples, 0.95).toFixed(3)),
    max: Number(Math.max(...samples).toFixed(3)),
  }
}

function computeRoutingBehaviorFingerprint(): string {
  const serialized = fixture.routingProbes.map((probe) => {
    const decision = makeRoutingDecision(probe.query, probe.appContext, {
      forceAgent: false,
      manualCapabilities: [],
      agentTaskContext: null,
      hasRecentEditContext: probe.appContext.hasRecentEdit ?? false,
      contextTagCount: probe.appContext.hasContextTags ? 1 : 0,
      messages: [],
    })
    return JSON.stringify({
      query: probe.query,
      mode: decision.mode,
      candidates: decision.candidates,
      required: decision.required,
      candidateTools: decision.candidateTools,
      reasonCodes: decision.reasonCodes,
    })
  }).join('\n')
  return hashText(serialized)
}

function evaluateToolParseSample(sample: ToolCallSample): boolean {
  const parsed = parseToolCall(sample.responseText)
  if (sample.expectedToolName === null) {
    return parsed === null
  }
  if (!parsed || parsed.name !== sample.expectedToolName) return false
  if (sample.expectedArgs === null) return true
  return JSON.stringify(parsed.args) === JSON.stringify(sample.expectedArgs)
}

function runDeterministicMetrics(): DeterministicMetrics {
  let expectedDirectCases = 0
  let expectedAgentCases = 0
  let directMisjudgments = 0
  let agentMisjudgments = 0
  let forbiddenViolationCases = 0
  let missingRequiredCases = 0
  let candidateToolsTotal = 0
  let toolParseSampleCount = 0
  let toolParseSuccesses = 0
  const mismatchCaseIds: string[] = []
  const forbiddenViolationCaseIds: string[] = []

  for (const testCase of fixture.cases) {
    const decision = makeRoutingDecision(testCase.query, testCase.appContext, {
      forceAgent: false,
      manualCapabilities: [],
      agentTaskContext: null,
      hasRecentEditContext: testCase.appContext.hasRecentEdit ?? false,
      contextTagCount: testCase.appContext.hasContextTags ? 1 : 0,
      messages: [],
    })

    if (testCase.expectedMode === 'direct') {
      expectedDirectCases += 1
      if (decision.mode !== 'direct') {
        directMisjudgments += 1
        mismatchCaseIds.push(testCase.id)
      }
    } else {
      expectedAgentCases += 1
      if (decision.mode !== 'agent') {
        agentMisjudgments += 1
        mismatchCaseIds.push(testCase.id)
      }
    }

    const forbiddenViolations = testCase.forbiddenCapabilities.filter((capability) =>
      decision.candidates.includes(capability),
    )
    if (forbiddenViolations.length > 0) {
      forbiddenViolationCases += 1
      forbiddenViolationCaseIds.push(testCase.id)
    }

    const missingRequired = testCase.requiredCapabilities.filter(
      (capability) => !decision.candidates.includes(capability),
    )
    if (missingRequired.length > 0) {
      missingRequiredCases += 1
    }

    candidateToolsTotal += decision.candidateTools.length

    if (testCase.toolCallSample) {
      toolParseSampleCount += 1
      if (evaluateToolParseSample(testCase.toolCallSample)) {
        toolParseSuccesses += 1
      }
    }
  }

  return {
    totalCases: fixture.cases.length,
    expectedDirectCases,
    expectedAgentCases,
    directMisjudgments,
    agentMisjudgments,
    directMisjudgmentRate: rate(directMisjudgments, expectedDirectCases),
    agentMisjudgmentRate: rate(agentMisjudgments, expectedAgentCases),
    capabilityMissRate: rate(missingRequiredCases, fixture.cases.length),
    capabilityOverReachRate: rate(forbiddenViolationCases, fixture.cases.length),
    toolParseSampleCount,
    toolParseSuccesses,
    toolParseSuccessRate: rate(toolParseSuccesses, toolParseSampleCount),
    avgCandidateTools: rate(candidateToolsTotal, fixture.cases.length),
    mismatchCaseIds,
    forbiddenViolationCaseIds,
    routingBehaviorFingerprint: computeRoutingBehaviorFingerprint(),
  }
}

// --- 确定性指标（两次运行必须一致） ---

const firstRun = runDeterministicMetrics()
const secondRun = runDeterministicMetrics()
const repeatable = JSON.stringify(firstRun) === JSON.stringify(secondRun)

// --- A/B 口径校验 ---

const currentDescriptor = getPromptVersionDescriptor()
const promptVariantDescriptor: PromptVersionDescriptor = {
  ...currentDescriptor,
  segmentFingerprints: {
    ...currentDescriptor.segmentFingerprints,
    baseSystemPrompt: hashText(`${currentDescriptor.segmentFingerprints.baseSystemPrompt}-variant`),
  },
}
const promptVariantDetectionWorks = (() => {
  const comparison = comparePromptVariants(
    { label: 'baseline', config: fixture.config, descriptor: currentDescriptor },
    { label: 'variant', config: fixture.config, descriptor: promptVariantDescriptor },
  )
  return comparison.comparable === true
    && comparison.promptChanged === true
    && comparison.changedSegments.includes('baseSystemPrompt')
})()

const configMismatchRejected = (() => {
  const comparison = comparePromptVariants(
    { label: 'baseline', config: fixture.config, descriptor: currentDescriptor },
    { label: 'other-config', config: { ...fixture.config, model: 'different-model' }, descriptor: currentDescriptor },
  )
  return comparison.comparable === false
})()

// --- 延迟指标（允许波动，仅记录） ---

const routingDecisionLatency = measureLatencies(50, () => {
  for (const testCase of fixture.cases) {
    makeRoutingDecision(testCase.query, testCase.appContext, {
      forceAgent: false,
      manualCapabilities: [],
      agentTaskContext: null,
      hasRecentEditContext: testCase.appContext.hasRecentEdit ?? false,
      contextTagCount: testCase.appContext.hasContextTags ? 1 : 0,
      messages: [],
    })
  }
})

const promptAssemblyLatency = measureLatencies(50, () => {
  buildSystemMessages()
  buildSystemMessages('回答保持简洁，优先使用中文。')
  buildSystemMessages(undefined, 'selection_direct')
})

const toolParseSamples = fixture.cases
  .map((testCase) => testCase.toolCallSample)
  .filter((sample): sample is ToolCallSample => sample !== null)
const toolParseLatency = measureLatencies(50, () => {
  for (const sample of toolParseSamples) {
    parseToolCall(sample.responseText)
  }
})

// --- 输出与基线断言 ---

const report: EvaluationReport = {
  fixtureVersion: fixture.version,
  promptDescriptor: currentDescriptor,
  evaluationConfig: fixture.config,
  evaluationConfigFingerprint: getEvaluationConfigFingerprint(fixture.config),
  deterministic: firstRun,
  latencyMs: {
    routingDecision: routingDecisionLatency,
    promptAssembly: promptAssemblyLatency,
    toolParse: toolParseLatency,
  },
  abCheck: {
    repeatable,
    promptVariantDetectionWorks,
    configMismatchRejected,
  },
}

console.log(JSON.stringify(report, null, 2))

assert.equal(getEvaluationConfigFingerprint(fixture.config), getEvaluationConfigFingerprint(OFFLINE_DETERMINISTIC_CONFIG), 'fixture config must match the frozen offline-deterministic config')
assert.equal(repeatable, true, 'deterministic metrics must be repeatable within the same build')
assert.equal(promptVariantDetectionWorks, true, 'prompt variant comparison must detect changed prompt segments')
assert.equal(configMismatchRejected, true, 'A/B comparison must reject differing evaluation configs')
assert.equal(firstRun.toolParseSuccessRate, 1, 'all parseable tool call samples must parse correctly')
assert.ok(firstRun.totalCases >= 30, 'regression set must cover at least 30 cases')
assert.ok(fixture.routingProbes.length >= 10, 'routing behavior probes must cover at least 10 probes')
