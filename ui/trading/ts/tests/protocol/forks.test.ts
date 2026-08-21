import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, getAddress, keccak256, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { getChildUniverseId, loadForkMigrationContext } from '../../protocol/forks.js'

const pool = getAddress(`0x${'11'.repeat(20)}`)
const shareToken = getAddress(`0x${'22'.repeat(20)}`)
const zoltar = getAddress(`0x${'33'.repeat(20)}`)
const questionData = getAddress(`0x${'44'.repeat(20)}`)
const canonicalPool = getAddress(`0x${'55'.repeat(20)}`)
const market = { pool, shareToken, universeId: 7n }

const universeOutputs = [
	{ name: 'forkTime', type: 'uint256' },
	{ name: 'forkQuestionId', type: 'uint256' },
	{ name: 'forkingOutcomeIndex', type: 'uint256' },
	{ name: 'reputationToken', type: 'address' },
	{ name: 'parentUniverseId', type: 'uint248' },
] as const

const questionOutputs = [
	{ name: 'title', type: 'string' },
	{ name: 'description', type: 'string' },
	{ name: 'startTime', type: 'uint48' },
	{ name: 'endTime', type: 'uint48' },
	{ name: 'numTicks', type: 'uint120' },
	{ name: 'displayValueMin', type: 'int256' },
	{ name: 'displayValueMax', type: 'int256' },
	{ name: 'answerUnit', type: 'string' },
] as const

const deployedChildOutputs = [
	{ name: 'outcomeIndexes', type: 'uint256[]' },
	{ name: 'childUniverseIds', type: 'uint248[]' },
	{ name: 'childUniverses', type: 'tuple[]', components: universeOutputs },
] as const

const selectors = {
	zoltar: selector('zoltar()'),
	questionData: selector('questionData()'),
	universes: selector('universes(uint248)'),
	deployedChildren: selector('getDeployedChildUniverses(uint248,uint256,uint256)'),
	questions: selector('questions(uint256)'),
	outcomeLabels: selector('getOutcomeLabels(uint256,uint256,uint256)'),
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

function publicClient(handler: (callSelector: string) => Promise<string> | string) {
	return createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method !== 'eth_call') throw new Error(`Unexpected RPC method: ${method}`)
				return await handler(requestSelector(params))
			},
		}),
	})
}

function encodedAddress(address: Address) {
	return encodeAbiParameters([{ type: 'address' }], [address])
}

function encodedUniverse(forkQuestionId: bigint) {
	return encodeAbiParameters(universeOutputs, [1n, forkQuestionId, 0n, zeroAddress, 0n])
}

function encodedQuestion(title: string, numTicks: bigint, displayValueMin = 0n, displayValueMax = 0n, answerUnit = '') {
	return encodeAbiParameters(questionOutputs, [title, 'Fork metadata', 1n, 2n, numTicks, displayValueMin, displayValueMax, answerUnit])
}

function commonResponse(callSelector: string, question: string) {
	if (callSelector === selectors.zoltar) return encodedAddress(zoltar)
	if (callSelector === selectors.questionData) return encodedAddress(questionData)
	if (callSelector === selectors.universes) return encodedUniverse(99n)
	if (callSelector === selectors.questions) return question
	return undefined
}

describe('fork protocol helpers', () => {
	test('derives the Solidity child universe ID from the parent and scalar outcome', () => {
		expect(getChildUniverseId(7n, 42n)).toBe(314759649437236790502340698995905624569868907448583953074618328891806893637n)
	})

	test('rejects values outside the contract integer bounds', () => {
		expect(() => getChildUniverseId(-1n, 42n)).toThrow('uint248')
		expect(() => getChildUniverseId(7n, -1n)).toThrow('uint256')
		expect(() => getChildUniverseId(7n, 1n << 256n)).toThrow('uint256')
	})

	test('loads paginated categorical branches with Invalid and canonical-pool readiness', async () => {
		let labelsPage = 0
		let canonicalPoolRead = 0
		const firstLabels = Array.from({ length: 30 }, (_, index) => `Choice ${index + 1}`)
		const client = publicClient(callSelector => {
			const common = commonResponse(callSelector, encodedQuestion('Categorical fork', 0n))
			if (common !== undefined) return common
			if (callSelector === selectors.outcomeLabels) {
				labelsPage++
				return encodeAbiParameters([{ type: 'string[]' }], [labelsPage === 1 ? firstLabels : ['Choice 31', 'Choice 32']])
			}
			if (callSelector === selectors.canonicalPool) {
				canonicalPoolRead++
				return encodedAddress(canonicalPoolRead % 2 === 0 ? canonicalPool : zeroAddress)
			}
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})

		const context = await loadForkMigrationContext(client, market)

		expect(context.kind).toBe('categorical')
		expect(context.title).toBe('Categorical fork')
		expect(context.availableTargets).toHaveLength(33)
		expect(context.availableTargets[0]).toMatchObject({ outcomeIndex: 0n, label: 'Invalid', canonicalPool: undefined })
		expect(context.availableTargets[1]).toMatchObject({ outcomeIndex: 1n, label: 'Choice 1', canonicalPool })
		expect(context.availableTargets.at(-1)).toMatchObject({ outcomeIndex: 32n, label: 'Choice 32', canonicalPool: undefined })
		expect(labelsPage).toBe(2)
	})

	test('loads paginated deployed scalar children with labels and ready or missing pools', async () => {
		let childPage = 0
		let answerNameRead = 0
		let canonicalPoolRead = 0
		const firstOutcomes = Array.from({ length: 30 }, (_, index) => BigInt(index + 1))
		const secondOutcomes = [75n]
		const childPageResult = (outcomeIndexes: readonly bigint[]) => encodeAbiParameters(deployedChildOutputs, [outcomeIndexes, outcomeIndexes.map(outcomeIndex => getChildUniverseId(market.universeId, outcomeIndex)), outcomeIndexes.map(outcomeIndex => [1n, 99n, outcomeIndex, zeroAddress, market.universeId])])
		const client = publicClient(callSelector => {
			const common = commonResponse(callSelector, encodedQuestion('Temperature fork', 100n, -50n * 10n ** 18n, 50n * 10n ** 18n, '°C'))
			if (common !== undefined) return common
			if (callSelector === selectors.outcomeLabels) return encodeAbiParameters([{ type: 'string[]' }], [[]])
			if (callSelector === selectors.deployedChildren) {
				childPage++
				return childPageResult(childPage === 1 ? firstOutcomes : secondOutcomes)
			}
			if (callSelector === selectors.answerOptionName) {
				answerNameRead++
				return encodeAbiParameters([{ type: 'string' }], [`On-chain scalar ${answerNameRead}`])
			}
			if (callSelector === selectors.canonicalPool) {
				canonicalPoolRead++
				return encodedAddress(canonicalPoolRead % 2 === 0 ? canonicalPool : zeroAddress)
			}
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})

		const context = await loadForkMigrationContext(client, market)

		expect(context).toMatchObject({ kind: 'scalar', title: 'Temperature fork', numTicks: 100n, displayValueMin: -50n * 10n ** 18n, displayValueMax: 50n * 10n ** 18n, answerUnit: '°C' })
		expect(context.availableTargets).toHaveLength(31)
		expect(context.availableTargets[0]).toMatchObject({ outcomeIndex: 1n, label: 'On-chain scalar 1', canonicalPool: undefined })
		expect(context.availableTargets[1]).toMatchObject({ outcomeIndex: 2n, label: 'On-chain scalar 2', canonicalPool })
		expect(context.availableTargets.at(-1)).toMatchObject({ outcomeIndex: 75n, label: 'On-chain scalar 31', canonicalPool: undefined })
		expect(childPage).toBe(2)
	})

	test('rejects malformed scalar child pages and surfaces RPC failures', async () => {
		const malformedClient = publicClient(callSelector => {
			const common = commonResponse(callSelector, encodedQuestion('Malformed fork', 10n, 0n, 10n))
			if (common !== undefined) return common
			if (callSelector === selectors.outcomeLabels) return encodeAbiParameters([{ type: 'string[]' }], [[]])
			if (callSelector === selectors.deployedChildren) return encodeAbiParameters(deployedChildOutputs, [[1n], [], []])
			if (callSelector === selectors.answerOptionName) return encodeAbiParameters([{ type: 'string' }], ['One'])
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})
		await expect(loadForkMigrationContext(malformedClient, market)).rejects.toThrow('Malformed deployed child universe page')

		const failingClient = publicClient(callSelector => {
			if (callSelector === selectors.zoltar) return encodedAddress(zoltar)
			if (callSelector === selectors.questionData) throw new Error('question data RPC unavailable')
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})
		await expect(loadForkMigrationContext(failingClient, market)).rejects.toThrow('question data RPC unavailable')
	})
})
