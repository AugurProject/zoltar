/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { loadMarketDetails, loadZoltarQuestionPage, loadZoltarUniverseSummary } from '../../protocol/zoltar.js'

const QUESTION_TUPLE_BINARY = ['Binary question', 'desc', 1n, 2n, 0n, 0n, 100n, '']
const QUESTION_TUPLE_SCALAR = ['Scalar question', 'desc', 1n, 2n, 100n, -10n, 10n, 'units']
const EMPTY_QUESTION = ['', '', 0n, 0n, 0n, 0n, 0n, '']
const REP_TOKEN = getAddress('0x00000000000000000000000000000000000000f1')

type MockReadClient = Parameters<typeof loadMarketDetails>[0]

function createReadClient({ multicallResponses, readContractHandlers }: { multicallResponses: unknown[]; readContractHandlers: Record<string, () => Promise<unknown>> }): MockReadClient {
	let callIndex = 0

	return {
		multicall: async () => {
			const response = multicallResponses[callIndex]
			if (response === undefined) throw new Error('No queued multicall response')
			callIndex += 1
			return response
		},
		readContract: async (request: Parameters<MockReadClient['readContract']>[0]) => {
			if (typeof request.functionName !== 'string') throw new Error('Expected function name')
			const handler = readContractHandlers[request.functionName]
			if (handler === undefined) throw new Error(`Unexpected readContract function: ${request.functionName}`)
			return await handler()
		},
	} as unknown as MockReadClient
}

describe('zoltar contract helpers', () => {
	test('loadMarketDetails marks missing question data as non-existent without loading labels', async () => {
		const readContractCalls: string[] = []
		const client = createReadClient({
			multicallResponses: [[EMPTY_QUESTION, 0n]],
			readContractHandlers: {
				getOutcomeLabels: async () => {
					readContractCalls.push('getOutcomeLabels')
					return ['Yes']
				},
			},
		})

		const market = await loadMarketDetails(client, 123n)

		expect(market.exists).toBe(false)
		expect(market.outcomeLabels).toEqual([])
		expect(readContractCalls).toEqual([])
		expect(market.marketType).toBe('categorical')
		expect(market.questionId).toBe('0x7b')
	})

	test('loadMarketDetails loads binary outcome labels for an existing question', async () => {
		const outcomeLabels = ['Yes', 'No']
		const readContractCalls: string[] = []
		const client = createReadClient({
			multicallResponses: [[QUESTION_TUPLE_BINARY, 1n]],
			readContractHandlers: {
				getOutcomeLabels: async () => {
					readContractCalls.push('getOutcomeLabels')
					return outcomeLabels
				},
			},
		})

		const market = await loadMarketDetails(client, 456n)

		expect(market.exists).toBe(true)
		expect(market.marketType).toBe('binary')
		expect(market.outcomeLabels).toEqual(outcomeLabels)
		expect(readContractCalls).toEqual(['getOutcomeLabels'])
	})

	test('loadZoltarQuestionPage loads only the requested page of questions', async () => {
		const client = createReadClient({
			multicallResponses: [
				[QUESTION_TUPLE_BINARY, 1n],
				[QUESTION_TUPLE_SCALAR, 1n],
			],
			readContractHandlers: {
				getQuestionCount: async () => 5n,
				getQuestions: async () => [101n, 102n],
				getOutcomeLabels: async () => ['Yes', 'No'],
			},
		})

		const page = await loadZoltarQuestionPage(client, 1, 2)

		expect(page.questionCount).toBe(5n)
		expect(page.pageIndex).toBe(1)
		expect(page.pageSize).toBe(2)
		expect(page.questions.map(question => question.questionId)).toEqual(['0x65', '0x66'])
	})

	test('loadZoltarUniverseSummary returns a non-forked universe summary for an active universe', async () => {
		const client = createReadClient({
			multicallResponses: [
				[REP_TOKEN, [0n, 9n, 0n, getAddress('0x00000000000000000000000000000000000000ff'), 123n], 0n, 999n, 5n],
				[QUESTION_TUPLE_BINARY, 0n],
			],
			readContractHandlers: {
				getTotalTheoreticalSupply: async () => 111n,
				getOutcomeLabels: async () => ['Yes', 'No'],
			},
		})

		const summary = await loadZoltarUniverseSummary(client, 5n)

		expect(summary).toBeDefined()
		expect(summary?.hasForked).toBe(false)
		expect(summary?.forkQuestionDetails).toBeUndefined()
		expect(summary?.childUniverses).toEqual([])
		expect(summary?.totalTheoreticalSupply).toBe(111n)
		expect(summary?.forkBurnDivisor).toBe(5n)
		expect(summary?.zoltarAddress).toBeDefined()
	})

	test('loadZoltarUniverseSummary handles forked scalar details and an empty child-universe page', async () => {
		const client = createReadClient({
			multicallResponses: [
				[REP_TOKEN, [0n, 55n, 2n, getAddress('0x0000000000000000000000000000000000000000'), 77n], 15n, 5n, 5n],
				[QUESTION_TUPLE_SCALAR, 1n],
			],
			readContractHandlers: {
				getTotalTheoreticalSupply: async () => 222n,
				getOutcomeLabels: async () => [],
				getDeployedChildUniverses: async () => [[], [], []],
			},
		})

		const summary = await loadZoltarUniverseSummary(client, 8n)

		expect(summary).toBeDefined()
		expect(summary?.forkQuestionDetails?.marketType).toBe('scalar')
		expect(summary?.hasForked).toBe(true)
		expect(summary?.childUniverses).toEqual([])
	})

	test('loadZoltarUniverseSummary builds categorical child universes from fork question outcome ids', async () => {
		const childUniverseTuple1 = [1n, 2n, 3n, getAddress('0x0000000000000000000000000000000000000010'), 99n]
		const childUniverseTuple2 = [4n, 5n, 6n, getAddress('0x0000000000000000000000000000000000000020'), 98n]
		const childUniverseTuple3 = [7n, 8n, 9n, getAddress('0x0000000000000000000000000000000000000030'), 97n]
		const childUniverseIds = [10n, 20n, 30n]
		const client = createReadClient({
			multicallResponses: [[REP_TOKEN, [0n, 44n, 1n, getAddress('0x0000000000000000000000000000000000000000'), 123n], 12n, 9n, 5n], [QUESTION_TUPLE_BINARY, 1n], childUniverseIds, [childUniverseTuple1, childUniverseTuple2, childUniverseTuple3]],
			readContractHandlers: {
				getTotalTheoreticalSupply: async () => 999n,
				getOutcomeLabels: async () => ['Yes', 'No'],
				getChildUniverseId: async () => {
					throw new Error('getChildUniverseId should be resolved via multicall in this test')
				},
				universes: async () => {
					throw new Error('universes should be resolved via multicall in this test')
				},
			},
		})

		const summary = await loadZoltarUniverseSummary(client, 8n)

		expect(summary).toBeDefined()
		expect(summary?.childUniverses.map(universe => universe.outcomeIndex)).toEqual([0n, 1n, 2n])
		expect(summary?.childUniverses.map(universe => universe.exists)).toEqual([true, true, true])
		expect(summary?.childUniverses.map(universe => universe.parentUniverseId)).toEqual([99n, 98n, 97n])
		expect(summary?.forkQuestionDetails?.marketType).toBe('binary')
		expect(summary?.totalTheoreticalSupply).toBe(999n)
	})
})
