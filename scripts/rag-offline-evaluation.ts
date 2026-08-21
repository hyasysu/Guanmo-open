import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { vectorStore } from '../src/services/rag/vectorStore'
import { buildContextResult } from '../src/services/rag/pipeline'
import type { Document, SearchResult } from '../src/services/rag/types'

interface FixtureChunk { id: string; heading: string; content: string; embedding: number[] }
interface FixtureDocument { id: string; title: string; chunks: FixtureChunk[] }
interface FixtureQuery { id: string; query: string; embedding: number[] | null; relevantChunkIds: string[]; answerEvidence: string | null }
interface NeighborScenario { queryId: string; primaryChunkId: string; neighborChunkId: string; neighborContent: string; answerEvidence: string }
interface EvaluationFixture { version: number; topK: number; documents: FixtureDocument[]; queries: FixtureQuery[]; neighborScenarios: NeighborScenario[] }

const fixturePath = resolve(process.cwd(), 'tests/rag/fixtures/offlineEvaluation.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as EvaluationFixture

function rankOf(results: SearchResult[], relevant: Set<string>): number {
  const index = results.findIndex((result) => relevant.has(result.chunk.id))
  return index < 0 ? 0 : index + 1
}

function ndcg(results: SearchResult[], relevant: Set<string>, topK: number): number {
  if (relevant.size === 0) return 0
  const dcg = results.slice(0, topK).reduce((sum, result, index) => (
    sum + (relevant.has(result.chunk.id) ? 1 / Math.log2(index + 2) : 0)
  ), 0)
  const idealCount = Math.min(relevant.size, topK)
  const idcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0)
  return dcg / idcg
}

function search(query: FixtureQuery): SearchResult[] {
  return vectorStore.hybridSearch(query.query, query.embedding, fixture.topK, 0.5, {
    keywordSearchEnabled: true,
  })
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0
}

vectorStore.clear()
const now = 1_700_000_000_000
for (const [documentIndex, source] of fixture.documents.entries()) {
  const document: Document = {
    id: source.id,
    filePath: `C:\\anonymous-evaluation\\document-${documentIndex + 1}.md`,
    title: source.title,
    content: '',
    lastModified: now,
    chunks: source.chunks.map((chunk, chunkIndex) => ({
      ...chunk,
      documentId: source.id,
      index: chunkIndex,
      startLine: chunkIndex * 10 + 1,
      endLine: chunkIndex * 10 + 2,
      titlePath: [chunk.heading],
      sourceType: 'markdown' as const,
    })),
  }
  vectorStore.addDocument(document)
}

const coldStarted = performance.now()
search(fixture.queries[0])
const coldLatencyMs = performance.now() - coldStarted
const hotLatencies: number[] = []
for (let iteration = 0; iteration < 30; iteration += 1) {
  const started = performance.now()
  search(fixture.queries[iteration % fixture.queries.length])
  hotLatencies.push(performance.now() - started)
}

const answerable = fixture.queries.filter((query) => query.relevantChunkIds.length > 0)
const noAnswer = fixture.queries.filter((query) => query.relevantChunkIds.length === 0)
let recallHits = 0
let reciprocalRank = 0
let ndcgTotal = 0
let sourceHits = 0
let groundedHits = 0
let falseRecall = 0

for (const query of fixture.queries) {
  const results = search(query)
  const relevant = new Set(query.relevantChunkIds)
  if (relevant.size === 0) {
    if (results.length > 0) falseRecall += 1
    continue
  }
  const rank = rankOf(results, relevant)
  if (rank > 0) recallHits += 1
  reciprocalRank += rank > 0 ? 1 / rank : 0
  ndcgTotal += ndcg(results, relevant, fixture.topK)
  if (results[0] && relevant.has(results[0].chunk.id)) sourceHits += 1
  if (query.answerEvidence && results.some((result) => relevant.has(result.chunk.id) && result.chunk.content.includes(query.answerEvidence!))) {
    groundedHits += 1
  }
}

let neighborGains = 0
for (const scenario of fixture.neighborScenarios) {
  const query = fixture.queries.find((candidate) => candidate.id === scenario.queryId)!
  const primary = search(query).find((result) => result.chunk.id === scenario.primaryChunkId)!
  const neighbor = {
    ...primary.chunk,
    id: scenario.neighborChunkId,
    index: primary.chunk.index + 1,
    startLine: primary.chunk.endLine + 1,
    endLine: primary.chunk.endLine + 2,
    content: scenario.neighborContent,
  }
  const mainContext = buildContextResult([primary], Number.MAX_SAFE_INTEGER).text
  const expandedContext = buildContextResult([{
    ...primary,
    neighborChunks: [{ ...neighbor, contextRole: 'neighbor-context' }],
  }], Number.MAX_SAFE_INTEGER).text
  if (!mainContext.includes(scenario.answerEvidence) && expandedContext.includes(scenario.answerEvidence)) {
    neighborGains += 1
  }
}

const metrics = {
  fixtureVersion: fixture.version,
  queryCount: fixture.queries.length,
  topK: fixture.topK,
  recallAtK: recallHits / answerable.length,
  mrr: reciprocalRank / answerable.length,
  ndcgAtK: ndcgTotal / answerable.length,
  sourceAccuracy: sourceHits / answerable.length,
  noAnswerFalseRecallRate: falseRecall / noAnswer.length,
  groundedness: groundedHits / answerable.length,
  neighborContextGain: neighborGains / fixture.neighborScenarios.length,
  latencyMs: {
    cold: Number(coldLatencyMs.toFixed(3)),
    hotP50: Number(percentile(hotLatencies, 0.5).toFixed(3)),
    hotP95: Number(percentile(hotLatencies, 0.95).toFixed(3)),
  },
}

console.log(JSON.stringify(metrics, null, 2))
assert.equal(metrics.recallAtK, 1)
assert.equal(metrics.mrr, 1)
assert.equal(metrics.ndcgAtK, 1)
assert.equal(metrics.sourceAccuracy, 1)
assert.equal(metrics.noAnswerFalseRecallRate, 0)
assert.equal(metrics.groundedness, 1)
assert.equal(metrics.neighborContextGain, 1)
vectorStore.clear()
