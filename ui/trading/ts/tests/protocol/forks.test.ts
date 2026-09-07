import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, getAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getQuestionId } from '@zoltar/shared/questionId'
import { getChildUniverseId, loadForkMigrationContext } from '../../protocol/forks.js'
import { loadLiveQuestionFields, loadUniverseIds } from '../../protocol/live.js'

const pool = getAddress(`0x${'11'.repeat(20)}`)
const shareToken = getAddress(`0x${'22'.repeat(20)}`)
const zoltar = getAddress(`0x${'33'.repeat(20)}`)
const questionData = getAddress(`0x${'44'.repeat(20)}`)
const canonicalPool = getAddress(`0x${'55'.repeat(20)}`)
const market = { pool, shareToken, universeId: 7n }

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

const universeOutputs = [
	{ name: 'forkTime', type: 'uint256' },
	{ name: 'forkQuestionId', type: 'uint256' },
	{ name: 'forkingOutcomeIndex', type: 'uint256' },
	{ name: 'reputationToken', type: 'address' },
	{ name: 'parentUniverseId', type: 'uint248' },
] as const

const selectors = {
	zoltar: selector('zoltar()'),
	questionData: selector('questionData()'),
	universes: selector('universes(uint248)'),
	answerOptionName: selector('getAnswerOptionName(uint256,uint256)'),
	canonicalPool: selector('canonicalPoolByUniverse(uint248)'),
}

function selector(signature: string) {
	return keccak256(signature).slice(0, 10)
}

function requestSelector(params: unknown) {
	if (!Array.isArray(params)) throw new Error('RPC parameters must be an array')
	const transaction: unknown = params[0]
	if (typeof transaction !== 'object' || transaction === null) throw new Error('RPC transaction must be an object')
	const data: unknown = Reflect.get(transaction, 'data')
	if (typeof data !== 'string' || !data.startsWith('0x')) throw new Error('RPC transaction data must be hex')
	return data.slice(0, 10)
}

type RpcLog = Readonly<{
	address: Address
	blockHash: Hex
	blockNumber: Hex
	data: Hex
	logIndex: Hex
	removed: boolean
	topics: readonly Hex[]
	transactionHash: Hex
	transactionIndex: Hex
}>

let chainIdentity = 0

function publicClient(callHandler: (callSelector: string) => Promise<string> | string, logs: readonly RpcLog[] = [], currentBlockHash?: () => string) {
	chainIdentity += 1
	const blockHash = `0x${chainIdentity.toString(16).padStart(64, '0')}`
	return createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_call') return await callHandler(requestSelector(params))
				if (method === 'eth_getCode') return '0x01'
				if (method === 'eth_getBlockByNumber') {
					const requested = Array.isArray(params) ? params[0] : undefined
					const number = typeof requested === 'string' && requested !== 'latest' ? requested : '0x1'
					return { hash: currentBlockHash?.() ?? blockHash, number, parentHash: `0x${'00'.repeat(32)}`, timestamp: '0x1', transactions: [] }
				}
				if (method === 'eth_getLogs') {
					const filter = Array.isArray(params) ? params[0] : undefined
					const requestedAddress = typeof filter === 'object' && filter !== null ? Reflect.get(filter, 'address') : undefined
					const requestedTopics = typeof filter === 'object' && filter !== null ? Reflect.get(filter, 'topics') : undefined
					const topicZero = Array.isArray(requestedTopics) && typeof requestedTopics[0] === 'string' ? requestedTopics[0].toLowerCase() : undefined
					return logs.filter(log => (typeof requestedAddress !== 'string' || log.address.toLowerCase() === requestedAddress.toLowerCase()) && (topicZero === undefined || log.topics[0]?.toLowerCase() === topicZero))
				}
				throw new Error(`Unexpected RPC method: ${method}`)
			},
		}),
	})
}

function encodedAddress(address: Address) {
	return encodeAbiParameters([{ type: 'address' }], [address])
}

function encodedUniverse(forkQuestionId: bigint, forkingOutcomeIndex = 0n, parentUniverseId = 0n) {
	return encodeAbiParameters(universeOutputs, [1n, forkQuestionId, forkingOutcomeIndex, zeroAddress, parentUniverseId])
}

function rpcLog(address: Address, topics: readonly Hex[], data: Hex, logIndex: number): RpcLog {
	return {
		address,
		blockHash: `0x${'aa'.repeat(32)}`,
		blockNumber: '0x1',
		data,
		logIndex: toHex(logIndex),
		removed: false,
		topics,
		transactionHash: `0x${logIndex.toString(16).padStart(64, '0')}`,
		transactionIndex: '0x0',
	}
}

function questionDataFor(title: string, numTicks = 0n, displayValueMin = 0n, displayValueMax = 0n, answerUnit = '') {
	return { title, description: 'Fork metadata', startTime: 1n, endTime: 2n, numTicks, displayValueMin, displayValueMax, answerUnit }
}

function questionCreatedLog(title: string, outcomes: readonly string[], numTicks = 0n, displayValueMin = 0n, displayValueMax = 0n, answerUnit = '', overrideQuestionId?: bigint) {
	const question = questionDataFor(title, numTicks, displayValueMin, displayValueMax, answerUnit)
	const questionId = overrideQuestionId ?? getQuestionId(question, outcomes)
	return rpcLog(
		questionData,
		[keccak256('QuestionCreated(uint256,uint256,(string,string,uint48,uint48,uint120,int256,int256,string),string[])'), toHex(questionId, { size: 32 })],
		encodeAbiParameters([{ type: 'uint256' }, { type: 'tuple', components: questionComponents }, { type: 'string[]' }], [1n, question, outcomes]),
		0,
	)
}

function deployChildLog(outcomeIndex: bigint, logIndex: number, overrideChildUniverseId?: bigint, parentUniverseId = market.universeId) {
	const childUniverseId = overrideChildUniverseId ?? getChildUniverseId(parentUniverseId, outcomeIndex)
	return rpcLog(
		zoltar,
		[keccak256('DeployChild(address,uint248,uint256,uint248,address,uint256)'), toHex(parentUniverseId, { size: 32 }), toHex(outcomeIndex, { size: 32 }), toHex(childUniverseId, { size: 32 })],
		encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [pool, zeroAddress, 1n]),
		logIndex,
	)
}

function commonResponse(callSelector: string, forkQuestionId = 99n) {
	if (callSelector === selectors.zoltar) return encodedAddress(zoltar)
	if (callSelector === selectors.questionData) return encodedAddress(questionData)
	if (callSelector === selectors.universes) return encodedUniverse(forkQuestionId)
	return undefined
}

describe('fork protocol helpers', () => {
	const deployment = { chainId: 1, chainName: 'Test', rpcUrl: 'http://localhost', securityPoolFactory: pool, zoltar, factory: pool, router: pool, feeBps: 30 } as const

	test('derives the Solidity child universe ID from the parent and scalar outcome', () => {
		expect(getChildUniverseId(7n, 42n)).toBe(314759649437236790502340698995905624569868907448583953074618328891806893637n)
	})

	test('rejects values outside the contract integer bounds', () => {
		expect(() => getChildUniverseId(-1n, 42n)).toThrow('uint248')
		expect(() => getChildUniverseId(7n, -1n)).toThrow('uint256')
		expect(() => getChildUniverseId(7n, 1n << 256n)).toThrow('uint256')
	})

	test('rejects forged primary-discovery child IDs and stored routes', async () => {
		const forgedIdClient = publicClient(
			callSelector => {
				if (callSelector === selectors.universes) return encodedUniverse(0n, 1n, 0n)
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[deployChildLog(1n, 0, 42n, 0n)],
		)
		await expect(loadUniverseIds(forgedIdClient, deployment)).rejects.toThrow('mismatched deterministic child universe ID')

		const forgedRouteClient = publicClient(
			callSelector => {
				if (callSelector === selectors.universes) return encodedUniverse(0n, 2n, 0n)
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[deployChildLog(1n, 0, undefined, 0n)],
		)
		await expect(loadUniverseIds(forgedRouteClient, deployment)).rejects.toThrow('does not match its DeployChild route')
	})

	test('loads categorical branches from QuestionCreated metadata', async () => {
		let canonicalPoolRead = 0
		const labels = Array.from({ length: 32 }, (_, index) => `Choice ${index + 1}`)
		const forkQuestionId = getQuestionId(questionDataFor('Categorical fork'), labels)
		const client = publicClient(
			callSelector => {
				const common = commonResponse(callSelector, forkQuestionId)
				if (common !== undefined) return common
				if (callSelector === selectors.canonicalPool) {
					canonicalPoolRead++
					return encodedAddress(canonicalPoolRead % 2 === 0 ? canonicalPool : zeroAddress)
				}
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[questionCreatedLog('Categorical fork', labels)],
		)

		const context = await loadForkMigrationContext(client, market)
		expect(context.kind).toBe('categorical')
		expect(context.title).toBe('Categorical fork')
		expect(context.availableTargets).toHaveLength(33)
		expect(context.availableTargets[0]).toMatchObject({ outcomeIndex: 0n, label: 'Invalid', canonicalPool: undefined })
		expect(context.availableTargets[1]).toMatchObject({ outcomeIndex: 1n, label: 'Choice 1', canonicalPool })
		expect(context.availableTargets.at(-1)).toMatchObject({ outcomeIndex: 32n, label: 'Choice 32', canonicalPool: undefined })
	})

	test('loads deployed scalar children from DeployChild events', async () => {
		let answerNameRead = 0
		let canonicalPoolRead = 0
		let universeRead = 0
		const outcomes = [...Array.from({ length: 30 }, (_, index) => BigInt(index + 1)), 75n]
		const forkQuestionId = getQuestionId(questionDataFor('Temperature fork', 100n, -50n * 10n ** 18n, 50n * 10n ** 18n, '°C'), [])
		const client = publicClient(
			callSelector => {
				if (callSelector === selectors.universes) {
					universeRead += 1
					const outcomeIndex = outcomes[universeRead - 2]
					return outcomeIndex === undefined ? encodedUniverse(forkQuestionId) : encodedUniverse(0n, outcomeIndex, market.universeId)
				}
				const common = commonResponse(callSelector, forkQuestionId)
				if (common !== undefined) return common
				if (callSelector === selectors.answerOptionName) return encodeAbiParameters([{ type: 'string' }], [`On-chain scalar ${++answerNameRead}`])
				if (callSelector === selectors.canonicalPool) return encodedAddress(++canonicalPoolRead % 2 === 0 ? canonicalPool : zeroAddress)
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[questionCreatedLog('Temperature fork', [], 100n, -50n * 10n ** 18n, 50n * 10n ** 18n, '°C'), ...outcomes.map((outcome, index) => deployChildLog(outcome, index + 1))],
		)

		const context = await loadForkMigrationContext(client, market)
		expect(context).toMatchObject({ kind: 'scalar', title: 'Temperature fork', numTicks: 100n, displayValueMin: -50n * 10n ** 18n, displayValueMax: 50n * 10n ** 18n, answerUnit: '°C' })
		expect(context.availableTargets).toHaveLength(31)
		expect(context.availableTargets[0]).toMatchObject({ outcomeIndex: 1n, label: 'On-chain scalar 1', canonicalPool: undefined })
		expect(context.availableTargets[1]).toMatchObject({ outcomeIndex: 2n, label: 'On-chain scalar 2', canonicalPool })
		expect(context.availableTargets.at(-1)).toMatchObject({ outcomeIndex: 75n, label: 'On-chain scalar 31', canonicalPool: undefined })
	})

	test('rejects a scalar child whose stored route is forged or changes during route reads', async () => {
		const forkQuestionId = getQuestionId(questionDataFor('Temperature fork', 100n, -1n, 1n, '°C'), [])
		const logs = [questionCreatedLog('Temperature fork', [], 100n, -1n, 1n, '°C'), deployChildLog(1n, 1)]
		let universeRead = 0
		const response = (callSelector: string) => {
			if (callSelector === selectors.universes) return ++universeRead === 1 ? encodedUniverse(forkQuestionId) : encodedUniverse(0n, 2n, market.universeId)
			if (callSelector === selectors.answerOptionName) return encodeAbiParameters([{ type: 'string' }], ['One'])
			if (callSelector === selectors.canonicalPool) return encodedAddress(zeroAddress)
			const common = commonResponse(callSelector, forkQuestionId)
			if (common !== undefined) return common
			throw new Error(`Unexpected function selector: ${callSelector}`)
		}
		await expect(loadForkMigrationContext(publicClient(response, logs), market)).rejects.toThrow('does not match its DeployChild route')

		universeRead = 0
		let reorged = false
		const reorgResponse = (callSelector: string) => {
			if (callSelector === selectors.universes) {
				universeRead += 1
				if (universeRead > 1) reorged = true
				return universeRead === 1 ? encodedUniverse(forkQuestionId) : encodedUniverse(0n, 1n, market.universeId)
			}
			if (callSelector === selectors.answerOptionName) return encodeAbiParameters([{ type: 'string' }], ['One'])
			if (callSelector === selectors.canonicalPool) return encodedAddress(zeroAddress)
			const common = commonResponse(callSelector, forkQuestionId)
			if (common !== undefined) return common
			throw new Error(`Unexpected function selector: ${callSelector}`)
		}
		await expect(
			loadForkMigrationContext(
				publicClient(reorgResponse, logs, () => `0x${(reorged ? 'bb' : 'aa').repeat(32)}`),
				market,
			),
		).rejects.toThrow('changed during scalar fork discovery')
	})

	test('filters unrelated Zoltar logs before applying the child-event resident limit', async () => {
		const forkQuestionId = getQuestionId(questionDataFor('Temperature fork', 100n, -1n, 1n, '°C'), [])
		const unrelated = Array.from({ length: 10_001 }, (_, index) => rpcLog(zoltar, [keccak256('Unrelated(uint256)')], toHex(index), index + 2))
		let universeRead = 0
		const client = publicClient(
			callSelector => {
				if (callSelector === selectors.universes) return ++universeRead === 1 ? encodedUniverse(forkQuestionId) : encodedUniverse(0n, 1n, market.universeId)
				if (callSelector === selectors.answerOptionName) return encodeAbiParameters([{ type: 'string' }], ['One'])
				if (callSelector === selectors.canonicalPool) return encodedAddress(zeroAddress)
				const common = commonResponse(callSelector, forkQuestionId)
				if (common !== undefined) return common
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[questionCreatedLog('Temperature fork', [], 100n, -1n, 1n, '°C'), deployChildLog(1n, 1), ...unrelated],
		)
		expect((await loadForkMigrationContext(client, market)).availableTargets).toHaveLength(1)
	})

	test('rejects a fork question event with a mismatched deterministic ID', async () => {
		const client = publicClient(
			callSelector => {
				const common = commonResponse(callSelector, 99n)
				if (common !== undefined) return common
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[questionCreatedLog('Categorical fork', ['Yes', 'No'], 0n, 0n, 0n, '', 99n)],
		)
		await expect(loadForkMigrationContext(client, market)).rejects.toThrow('mismatched deterministic question ID')
	})

	test('rejects mismatched question metadata in primary live market discovery', async () => {
		const client = publicClient(() => {
			throw new Error('Unexpected contract read')
		}, [questionCreatedLog('Live question', ['Yes', 'No'], 0n, 0n, 0n, '', 99n)])
		await expect(loadLiveQuestionFields(client, questionData, 99n)).rejects.toThrow('mismatched deterministic question ID')
	})

	test('rejects a deployed child event with a mismatched deterministic ID', async () => {
		const forkQuestionId = getQuestionId(questionDataFor('Temperature fork', 100n, -1n, 1n, '°C'), [])
		const client = publicClient(
			callSelector => {
				const common = commonResponse(callSelector, forkQuestionId)
				if (common !== undefined) return common
				throw new Error(`Unexpected function selector: ${callSelector}`)
			},
			[questionCreatedLog('Temperature fork', [], 100n, -1n, 1n, '°C'), deployChildLog(1n, 1, 99n)],
		)
		await expect(loadForkMigrationContext(client, market)).rejects.toThrow('mismatched deterministic child universe ID')
	})

	test('rejects a missing creation event and surfaces RPC failures', async () => {
		const missingEventClient = publicClient(callSelector => {
			const common = commonResponse(callSelector)
			if (common !== undefined) return common
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})
		await expect(loadForkMigrationContext(missingEventClient, market)).rejects.toThrow('Fork question creation event is unavailable')

		const failingClient = publicClient(callSelector => {
			if (callSelector === selectors.zoltar) return encodedAddress(zoltar)
			if (callSelector === selectors.questionData) throw new Error('question data RPC unavailable')
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})
		await expect(loadForkMigrationContext(failingClient, market)).rejects.toThrow('question data RPC unavailable')
	})
})
