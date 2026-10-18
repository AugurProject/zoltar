import type { DiscoveryRun } from './discovery-context.ts'

import { registryDiscoveryIssue } from './discovery-coverage.ts'

import * as abis from '@zoltar/bot-shared/contracts/abi'
import { type Address } from '@zoltar/bot-shared/ethereum'

import type { QuestionSnapshot } from '../operations/types.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency, type ChaosReadClient } from './discovery-client.ts'
import { DISCOVERY_AGGREGATE_ITEM_LIMIT, type DiscoveryLimits } from './discovery-context.ts'

import { assertRegistryCountNotRegressed, collectCountedPages, cursorWithCanonicalCount, sameRegistryCursor, updateRegistryCommitment } from './discovery-registry.ts'

import { emptyCountedRegistryCursor, IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES, type CountedRegistryCursor } from './topology-schema.ts'

const DISCOVERY_QUESTION_RESIDENT_UTF8_BYTES = 32 * 1024 * 1024
const OUTCOME_LABEL_PAGE_SIZE = 256n
const utf8Encoder = new TextEncoder()

async function discoverOutcomeLabels(client: ChaosReadClient, questionData: Address, questionId: bigint, blockNumber: bigint, limits: DiscoveryLimits) {
	const outcomeLabels: string[] = []
	let utf8Bytes = 0
	for (;;) {
		const remaining = limits.maxOutcomeLabelsPerQuestion - outcomeLabels.length
		const requested = remaining === 0 ? 1n : BigInt(Math.min(remaining, Number(OUTCOME_LABEL_PAGE_SIZE)))
		const page = await client.readContract({ abi: abis.zoltarQuestionDataAbi, address: questionData, args: [questionId, BigInt(outcomeLabels.length), requested], blockNumber, functionName: 'getOutcomeLabels' })
		if (BigInt(page.length) > requested) throw new Error(`Question ${questionId.toString()} outcome-label page exceeded its requested size`)
		if (remaining === 0) {
			if (page.length === 0) return outcomeLabels
			throw new Error(`Question ${questionId.toString()} exceeds the configured ${limits.maxOutcomeLabelsPerQuestion.toString()}-label discovery limit`)
		}
		for (const label of page) {
			utf8Bytes += utf8Encoder.encode(label).byteLength
			if (utf8Bytes > limits.maxOutcomeLabelUtf8BytesPerQuestion) {
				throw new Error(`Question ${questionId.toString()} outcome labels exceed the configured ${limits.maxOutcomeLabelUtf8BytesPerQuestion.toString()}-byte UTF-8 discovery limit`)
			}
		}
		outcomeLabels.push(...page)
		if (BigInt(page.length) < requested) return outcomeLabels
	}
}

export async function discoverQuestions({ context, blockNumber, limits, topology, mutation, issues }: DiscoveryRun) {
	const { client, deployments } = context
	const count = await client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, blockNumber, functionName: 'getQuestionCount' })
	let cursor = topology.discoveryCursors.questions
	assertRegistryCountNotRegressed(cursor, count, 'Question registry')
	let retentionMode: CountedRegistryCursor['retentionMode'] = count <= BigInt(limits.maxQuestions) ? 'resident' : 'overflow'
	if (cursor.retentionMode === 'overflow' && retentionMode === 'resident' && BigInt(cursor.residentLimit) >= BigInt(limits.maxQuestions)) retentionMode = 'overflow'
	if (cursor.retentionMode === 'overflow' && retentionMode === 'resident') {
		cursor = emptyCountedRegistryCursor()
		topology.questions = []
		mutation.changed = true
	}
	if (retentionMode === 'overflow' && topology.questions.length > 0) {
		topology.questions = []
		mutation.changed = true
	}
	const canonicalCursor = cursorWithCanonicalCount(cursor, count, limits.maxQuestions, retentionMode)
	if (!sameRegistryCursor(cursor, canonicalCursor)) mutation.changed = true
	cursor = canonicalCursor
	if (cursor.retentionMode === 'resident' && BigInt(topology.questions.length) !== BigInt(cursor.nextIndex)) throw new Error('Question registry cursor does not match its retained canonical prefix')
	const collected = await collectCountedPages({
		count,
		label: 'Question discovery',
		maximumItems: limits.maxQuestions,
		pageSize: limits.maxQuestions,
		readPage: async (start, pageCount) => await client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, args: [start, pageCount], blockNumber, functionName: 'getQuestions' }),
		start: BigInt(cursor.nextIndex),
	})
	if (collected.values.length > 0) {
		cursor = {
			...cursor,
			commitment: updateRegistryCommitment(
				cursor.commitment,
				BigInt(cursor.nextIndex),
				collected.values.map(questionId => questionId.toString()),
			),
			nextIndex: collected.nextStart.toString(),
		}
		mutation.changed = true
	}
	if (cursor.retentionMode === 'resident' && collected.values.length > 0) {
		let residentBytes = topology.questions.reduce((total, question) => total + Buffer.byteLength(JSON.stringify(question), 'utf8'), 0)
		let residentItems = topology.questions.reduce((total, question) => total + 1 + question.outcomeLabels.length, 0)
		let overflowed = false
		const discovered = await mapWithConcurrency(collected.values, DISCOVERY_RPC_CONCURRENCY, async questionId => {
			if (overflowed) return undefined
			const [question, createdAt, labels] = await drainConcurrent([
				client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questions' }),
				client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questionCreatedTimestamp' }),
				discoverOutcomeLabels(client, deployments.questionData, questionId, blockNumber, limits),
			])
			const [, , startTime, endTime, numTicks] = question
			let kind: QuestionSnapshot['kind'] = 'categorical'
			if (labels.length === 0) kind = 'scalar'
			else if (labels.length === 2 && labels[0] === 'Yes' && labels[1] === 'No') kind = 'binary'
			const snapshot: QuestionSnapshot = {
				createdAt: createdAt.toString(),
				endTime: endTime.toString(),
				id: questionId.toString(),
				kind,
				numTicks: numTicks.toString(),
				outcomeLabels: [...labels],
				startTime: startTime.toString(),
			}
			const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
			residentBytes += snapshotBytes
			residentItems += 1 + snapshot.outcomeLabels.length
			if (snapshotBytes > IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES || residentBytes > DISCOVERY_QUESTION_RESIDENT_UTF8_BYTES || residentItems > DISCOVERY_AGGREGATE_ITEM_LIMIT) {
				overflowed = true
				return undefined
			}
			return snapshot
		})
		if (overflowed) {
			topology.questions = []
			cursor = { ...cursor, retentionMode: 'overflow' }
		} else {
			for (const question of discovered) {
				if (question === undefined) throw new Error('Question discovery omitted a retained result without exceeding its resident envelope')
				topology.questions.push({ ...question, outcomeLabels: [...question.outcomeLabels] })
			}
		}
	}
	topology.discoveryCursors.questions = cursor
	if (cursor.retentionMode === 'overflow' || !collected.complete) issues.push(registryDiscoveryIssue('questions', 'Question', cursor))
	if (cursor.retentionMode === 'overflow') return []
	if (!collected.complete || BigInt(topology.questions.length) !== count) throw new Error('Resident question registry did not reach its canonical count within the configured envelope')
	if (new Set(topology.questions.map(question => question.id)).size !== topology.questions.length) throw new Error('Question registry contains duplicate immutable question IDs')
	return topology.questions.map(question => ({ ...question, outcomeLabels: [...question.outcomeLabels] }))
}
