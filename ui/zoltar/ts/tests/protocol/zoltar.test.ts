/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getDeploymentSteps } from '../../protocol/deployment.js'
import { getQuestionId } from '../../protocol/helpers.js'
import { loadMarketDetails, loadZoltarQuestionCount, loadZoltarQuestionPage, loadZoltarUniverseSummary } from '../../protocol/zoltar.js'

const REP_TOKEN = getAddress('0x00000000000000000000000000000000000000f1')
const QUESTION_DATA_ADDRESS = getDeploymentSteps().find(step => step.id === 'zoltarQuestionData')?.address
if (QUESTION_DATA_ADDRESS === undefined) throw new Error('Question data deployment step is missing')

const questionComponents = [
	{ name: 'title', type: 'string' },
	{ name: 'description', type: 'string' },
	{ name: 'startTime', type: 'uint48' },
	{ name: 'endTime', type: 'uint48' },
	{ name: 'numTicks', type: 'uint120' },
	{ name: 'displayValueMin', type: 'int256' },
	{ name: 'displayValueMax', type: 'int256' },
	{ name: 'answerUnit', type: 'string' },
] as const

type MockReadClient = Parameters<typeof loadMarketDetails>[0]
type MockReadContractRequest = Parameters<MockReadClient['readContract']>[0]
type MockLog = Readonly<{ address: Address; data: Hex; topics: readonly Hex[]; blockNumber?: bigint }>

function questionObject(question: readonly [string, string, bigint, bigint, bigint, bigint, bigint, string]) {
	return { title: question[0], description: question[1], startTime: question[2], endTime: question[3], numTicks: question[4], displayValueMin: question[5], displayValueMax: question[6], answerUnit: question[7] }
}

function questionCreatedLog(question: readonly [string, string, bigint, bigint, bigint, bigint, bigint, string], outcomeOptions: readonly string[], questionId = getQuestionId(questionObject(question), outcomeOptions)): MockLog {
	return {
		address: QUESTION_DATA_ADDRESS,
		data: encodeAbiParameters([{ type: 'uint256' }, { type: 'tuple', components: questionComponents }, { type: 'string[]' }], [1n, question, outcomeOptions]),
		topics: [keccak256('QuestionCreated(uint256,uint256,(string,string,uint48,uint48,uint120,int256,int256,string),string[])'), toHex(questionId, { size: 32 })],
	}
}

function deployChildLog(universeId: bigint, outcomeIndex: bigint, childUniverseId: bigint): MockLog {
	return {
		address: getDeploymentSteps().find(step => step.id === 'zoltar')?.address ?? QUESTION_DATA_ADDRESS,
		data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [getAddress('0x0000000000000000000000000000000000000001'), getAddress('0x0000000000000000000000000000000000000002'), 1n]),
		topics: [keccak256('DeployChild(address,uint248,uint256,uint248,address,uint256)'), toHex(universeId, { size: 32 }), toHex(outcomeIndex, { size: 32 }), toHex(childUniverseId, { size: 32 })],
	}
}

let nextTestChainIdentity = 0n

function createReadClient({
	chainIdentity,
	deploymentBlock = 0n,
	head = 1n,
	logs = [],
	multicallResponses,
	onLogRange,
	readContractHandlers,
}: {
	chainIdentity?: bigint
	deploymentBlock?: bigint
	head?: bigint
	logs?: readonly MockLog[]
	multicallResponses: unknown[]
	onLogRange?: (fromBlock: bigint, toBlock: bigint) => void
	readContractHandlers: Record<string, (request: MockReadContractRequest) => Promise<unknown>>
}): MockReadClient {
	nextTestChainIdentity += 1n
	const identity = chainIdentity ?? nextTestChainIdentity
	let callIndex = 0
	return {
		getBlock: async request => {
			const number = request?.blockNumber ?? head
			return { hash: toHex((identity << 64n) + number, { size: 32 }), number, timestamp: 1n, transactions: [] }
		},
		getCode: async request => (request.blockNumber === undefined || request.blockNumber >= deploymentBlock ? '0x01' : '0x'),
		getLogs: async request => {
			if (request.fromBlock !== undefined && request.toBlock !== undefined) onLogRange?.(request.fromBlock, request.toBlock)
			const eventName = typeof request.event === 'object' && request.event !== null ? Reflect.get(request.event, 'name') : undefined
			let eventTopic: Hex | undefined
			if (eventName === 'QuestionCreated') eventTopic = keccak256('QuestionCreated(uint256,uint256,(string,string,uint48,uint48,uint120,int256,int256,string),string[])')
			else if (eventName === 'DeployChild') eventTopic = keccak256('DeployChild(address,uint248,uint256,uint248,address,uint256)')
			return logs.filter(
				log =>
					(log.blockNumber === undefined || ((request.fromBlock === undefined || log.blockNumber >= request.fromBlock) && (request.toBlock === undefined || log.blockNumber <= request.toBlock))) &&
					(request.address === undefined || log.address === request.address) &&
					(eventTopic === undefined || log.topics[0] === eventTopic),
			)
		},
		multicall: async () => {
			const response = multicallResponses[callIndex]
			if (response === undefined) throw new Error('No queued multicall response')
			callIndex += 1
			return response
		},
		readContract: async request => {
			if (typeof request.functionName !== 'string') throw new Error('Expected function name')
			const handler = readContractHandlers[request.functionName]
			if (handler === undefined) throw new Error(`Unexpected readContract function: ${request.functionName}`)
			return await handler(request)
		},
	} as MockReadClient
}

describe('zoltar contract helpers', () => {
	test('keeps individual questions and later pages readable beyond the RPC page item budget', async () => {
		const tuples = Array.from({ length: 10_001 }, (_, index) => [`Question ${index}`, '', 1n, 2n, 0n, 0n, 0n, ''] as const)
		const logs = tuples.map((question, index) => ({ ...questionCreatedLog(question, ['Yes', 'No']), blockNumber: BigInt(index + 1) }))
		const client = createReadClient({ logs, head: 10_001n, deploymentBlock: 1n, multicallResponses: [], readContractHandlers: {} })
		const first = tuples[0]
		if (first === undefined) throw new Error('Missing first question fixture')
		expect((await loadMarketDetails(client, getQuestionId(questionObject(first), ['Yes', 'No']))).title).toBe('Question 0')
		const page = await loadZoltarQuestionPage(client, 1_000, 10)
		expect(page.questionCount).toBe(10_001n)
		expect(page.questions.map(question => question.title)).toEqual(['Question 10000'])
	})

	test('loadMarketDetails marks a question without a creation event as non-existent', async () => {
		const client = createReadClient({ multicallResponses: [], readContractHandlers: {} })
		const market = await loadMarketDetails(client, 123n)
		expect(market.exists).toBe(false)
		expect(market.outcomeLabels).toEqual([])
		expect(market.marketType).toBe('binary')
		expect(market.questionId).toBe('0x7b')
	})

	test('loadMarketDetails reconstructs binary presentation metadata from QuestionCreated', async () => {
		const question = ['Binary question', 'desc', 1n, 2n, 0n, 0n, 0n, ''] as const
		const questionId = getQuestionId(questionObject(question), ['Yes', 'No'])
		const client = createReadClient({ logs: [questionCreatedLog(question, ['Yes', 'No'])], multicallResponses: [], readContractHandlers: {} })
		const market = await loadMarketDetails(client, questionId)
		expect(market.exists).toBe(true)
		expect(market.marketType).toBe('binary')
		expect(market.outcomeLabels).toEqual(['Yes', 'No'])
		expect(market.title).toBe('Binary question')
	})

	test('rejects a QuestionCreated event with a mismatched deterministic ID', async () => {
		const question = ['Binary question', 'desc', 1n, 2n, 0n, 0n, 0n, ''] as const
		const client = createReadClient({ logs: [questionCreatedLog(question, ['Yes', 'No'], 456n)], multicallResponses: [], readContractHandlers: {} })
		await expect(loadZoltarQuestionCount(client)).rejects.toThrow('mismatched deterministic question ID')
	})

	test('loadZoltarQuestionPage slices the ordered creation-event stream', async () => {
		const tuples = Array.from({ length: 5 }, (_, index) => [`Question ${index}`, '', 1n, 2n, 0n, 0n, 0n, ''] as const)
		const logs = tuples.map(question => questionCreatedLog(question, ['Yes', 'No']))
		const client = createReadClient({ logs, multicallResponses: [], readContractHandlers: {} })
		const page = await loadZoltarQuestionPage(client, 1, 2)
		expect(page.questionCount).toBe(5n)
		expect(page.pageIndex).toBe(1)
		expect(page.pageSize).toBe(2)
		expect(page.questions.map(question => question.questionId)).toEqual(tuples.slice(2, 4).map(question => toHex(getQuestionId(questionObject(question), ['Yes', 'No']))))
	})

	test('loadZoltarQuestionPage returns an empty page for an event offset beyond the stream', async () => {
		const client = createReadClient({ logs: [questionCreatedLog(['Question', '', 1n, 2n, 0n, 0n, 0n, ''], ['Yes', 'No'])], multicallResponses: [], readContractHandlers: {} })
		const page = await loadZoltarQuestionPage(client, Number.MAX_SAFE_INTEGER, 3)
		expect(page.questions).toEqual([])
		expect(page.questionCount).toBe(1n)
	})

	test('question discovery uses bounded ranges and reuses its canonical event cache', async () => {
		const ranges: Array<readonly [bigint, bigint]> = []
		const client = createReadClient({ deploymentBlock: 19_000n, head: 20_000n, multicallResponses: [], onLogRange: (fromBlock, toBlock) => ranges.push([fromBlock, toBlock]), readContractHandlers: {} })
		expect(await loadZoltarQuestionCount(client)).toBe(0n)
		expect(ranges).toEqual([[19_000n, 20_000n]])
		await loadZoltarQuestionPage(client, 0, 10)
		expect(ranges).toHaveLength(1)
	})

	test('question discovery fails closed when the event history exceeds its resident limit', async () => {
		const question = ['Question', '', 1n, 2n, 0n, 0n, 0n, ''] as const
		const logs = Array.from({ length: 10_001 }, (_, index) => questionCreatedLog([`${question[0]} ${index.toString()}`, ...question.slice(1)] as typeof question, ['Yes', 'No']))
		const client = createReadClient({ logs, multicallResponses: [], readContractHandlers: {} })
		await expect(loadZoltarQuestionPage(client, 0, 10)).rejects.toThrow('exceeds the configured 10000-item limit')
	})

	test('loadZoltarUniverseSummary returns a non-forked universe summary for an active universe', async () => {
		const client = createReadClient({
			multicallResponses: [[REP_TOKEN, [0n, 9n, 0n, getAddress('0x00000000000000000000000000000000000000ff'), 123n], 0n, 999n, 5n]],
			readContractHandlers: { getTotalTheoreticalSupplyAttoRep: async () => 111n },
		})
		const summary = await loadZoltarUniverseSummary(client, 5n)
		expect(summary?.hasForked).toBe(false)
		expect(summary?.forkQuestionDetails).toBeUndefined()
		expect(summary?.childUniverses).toEqual([])
		expect(summary?.totalTheoreticalSupplyAttoRep).toBe(111n)
		expect(summary?.forkBurnDivisor).toBe(5n)
	})

	test('loadZoltarUniverseSummary handles scalar forks with no deployed child events', async () => {
		const scalarQuestion = ['Scalar question', 'desc', 1n, 2n, 100n, -10n, 10n, 'units'] as const
		const scalarQuestionId = getQuestionId(questionObject(scalarQuestion), [])
		const client = createReadClient({
			logs: [questionCreatedLog(scalarQuestion, [])],
			multicallResponses: [[REP_TOKEN, [0n, scalarQuestionId, 2n, getAddress('0x0000000000000000000000000000000000000000'), 77n], 15n, 5n, 5n], []],
			readContractHandlers: { getTotalTheoreticalSupplyAttoRep: async () => 222n },
		})
		const summary = await loadZoltarUniverseSummary(client, 8n)
		expect(summary?.forkQuestionDetails?.marketType).toBe('scalar')
		expect(summary?.hasForked).toBe(true)
		expect(summary?.childUniverses).toEqual([])
	})

	test('rejects a forked universe whose required question creation event is missing', async () => {
		const client = createReadClient({
			multicallResponses: [[REP_TOKEN, [0n, 123n, 2n, zeroAddress, 77n], 15n, 5n, 5n]],
			readContractHandlers: { getTotalTheoreticalSupplyAttoRep: async () => 222n },
		})
		await expect(loadZoltarUniverseSummary(client, 8n)).rejects.toThrow('Required QuestionCreated event is missing for question 123')
	})

	test('rejects a scalar child event with a mismatched deterministic universe ID', async () => {
		const scalarQuestion = ['Scalar question', 'desc', 1n, 2n, 100n, -10n, 10n, 'units'] as const
		const scalarQuestionId = getQuestionId(questionObject(scalarQuestion), [])
		const client = createReadClient({
			logs: [questionCreatedLog(scalarQuestion, []), deployChildLog(8n, 1n, 99n)],
			multicallResponses: [[REP_TOKEN, [0n, scalarQuestionId, 2n, getAddress('0x0000000000000000000000000000000000000000'), 77n], 15n, 5n, 5n]],
			readContractHandlers: { getTotalTheoreticalSupplyAttoRep: async () => 222n },
		})
		await expect(loadZoltarUniverseSummary(client, 8n)).rejects.toThrow('mismatched deterministic child universe ID')
	})

	test('loadZoltarUniverseSummary derives categorical child universes directly', async () => {
		const binaryQuestion = ['Binary question', 'desc', 1n, 2n, 0n, 0n, 0n, ''] as const
		const binaryQuestionId = getQuestionId(questionObject(binaryQuestion), ['Yes', 'No'])
		const childUniverseTuples = [
			[1n, 2n, 0n, getAddress('0x0000000000000000000000000000000000000010'), 8n],
			[4n, 5n, 1n, getAddress('0x0000000000000000000000000000000000000020'), 8n],
			[7n, 8n, 2n, getAddress('0x0000000000000000000000000000000000000030'), 8n],
		]
		const client = createReadClient({
			logs: [questionCreatedLog(binaryQuestion, ['Yes', 'No'])],
			multicallResponses: [[REP_TOKEN, [0n, binaryQuestionId, 1n, getAddress('0x0000000000000000000000000000000000000000'), 123n], 12n, 9n, 5n], [10n, 20n, 30n], childUniverseTuples],
			readContractHandlers: {
				getTotalTheoreticalSupplyAttoRep: async () => 999n,
				getChildUniverseId: async () => {
					throw new Error('getChildUniverseId should be resolved via multicall in this test')
				},
				universes: async () => {
					throw new Error('universes should be resolved via multicall in this test')
				},
			},
		})
		const summary = await loadZoltarUniverseSummary(client, 8n)
		expect(summary?.childUniverses.map(universe => universe.outcomeIndex)).toEqual([0n, 1n, 2n])
		expect(summary?.childUniverses.map(universe => universe.exists)).toEqual([true, true, true])
		expect(summary?.childUniverses.map(universe => universe.parentUniverseId)).toEqual([8n, 8n, 8n])
		expect(summary?.forkQuestionDetails?.marketType).toBe('binary')
		expect(summary?.totalTheoreticalSupplyAttoRep).toBe(999n)
	})

	test('keeps undeployed categorical children as explicit zero-tuple entries', async () => {
		const binaryQuestion = ['Binary question', 'desc', 1n, 2n, 0n, 0n, 0n, ''] as const
		const binaryQuestionId = getQuestionId(questionObject(binaryQuestion), ['Yes', 'No'])
		const client = createReadClient({
			logs: [questionCreatedLog(binaryQuestion, ['Yes', 'No'])],
			multicallResponses: [
				[REP_TOKEN, [0n, binaryQuestionId, 1n, getAddress('0x0000000000000000000000000000000000000000'), 123n], 12n, 9n, 5n],
				[10n, 20n, 30n],
				[
					[1n, 2n, 0n, getAddress('0x0000000000000000000000000000000000000010'), 8n],
					[0n, 0n, 0n, zeroAddress, 0n],
					[0n, 0n, 0n, zeroAddress, 0n],
				],
			],
			readContractHandlers: { getTotalTheoreticalSupplyAttoRep: async () => 999n },
		})
		const summary = await loadZoltarUniverseSummary(client, 8n)
		expect(summary?.childUniverses.map(universe => universe.exists)).toEqual([true, false, false])
		expect(summary?.childUniverses.slice(1).every(universe => universe.parentUniverseId === 0n && universe.reputationToken === zeroAddress)).toBeTrue()
	})
})
