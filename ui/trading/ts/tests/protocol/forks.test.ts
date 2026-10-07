import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, isHex, keccak256, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_tokens_ShareToken_ShareToken } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { largestMigratedShares, loadForkMigrationContext, targetMigrationComplete } from '../../protocol/forks.js'

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
	migratedShares: selector('getMigratedShareAmountAttoShares(uint256,uint248,address)'),
}

function selector(signature: string) {
	return keccak256(signature).slice(0, 10)
}

function requestData(params: unknown): Hex {
	if (!Array.isArray(params)) throw new Error('RPC parameters must be an array')
	const transaction: unknown = params[0]
	if (typeof transaction !== 'object' || transaction === null) throw new Error('RPC transaction must be an object')
	const data: unknown = Reflect.get(transaction, 'data')
	if (typeof data !== 'string' || !isHex(data)) throw new Error('RPC transaction data must be hex')
	return data
}

function publicClient(handler: (callSelector: string, data: Hex) => Promise<string> | string) {
	return createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method !== 'eth_call') throw new Error(`Unexpected RPC method: ${method}`)
				const data = requestData(params)
				return await handler(data.slice(0, 10), data)
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

// Mirrors Zoltar's child universe derivation for fixture IDs: keccak(uint248 parent, uint256 outcome) masked to uint248.
const getChildUniverseId = (parentUniverseId: bigint, outcomeIndex: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [parentUniverseId, outcomeIndex]))) & ((1n << 248n) - 1n)

describe('fork protocol helpers', () => {
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

	test('reads what an account already migrated into each child universe that has a security pool', async () => {
		const account = getAddress(`0x${'66'.repeat(20)}`)
		const yesUniverse = getChildUniverseId(market.universeId, 1n)
		const migratedReads: { fromId: bigint; universeId: bigint; account: Address }[] = []
		const client = publicClient((callSelector, data) => {
			const common = commonResponse(callSelector, encodedQuestion('Categorical fork', 0n))
			if (common !== undefined) return common
			if (callSelector === selectors.outcomeLabels) return encodeAbiParameters([{ type: 'string[]' }], [['Yes', 'No']])
			if (callSelector === selectors.canonicalPool) {
				const decoded = decodeFunctionData({ abi: statoblast_tokens_ShareToken_ShareToken.abi, data })
				return encodedAddress(decoded.args[0] === yesUniverse ? canonicalPool : zeroAddress)
			}
			if (callSelector === selectors.migratedShares) {
				const decoded = decodeFunctionData({ abi: statoblast_tokens_ShareToken_ShareToken.abi, data })
				const [fromId, universeId, reader] = decoded.args
				if (typeof fromId !== 'bigint' || typeof universeId !== 'bigint' || typeof reader !== 'string') throw new Error('Malformed migrated-share read')
				migratedReads.push({ fromId, universeId, account: getAddress(reader) })
				// The account migrated its Yes shares (source token universe << 8 | 1) into the Yes universe.
				return encodeAbiParameters([{ type: 'uint256' }], [fromId === ((market.universeId << 8n) | 1n) ? 5n : 0n])
			}
			throw new Error(`Unexpected function selector: ${callSelector}`)
		})

		const anonymous = await loadForkMigrationContext(client, market)
		expect(migratedReads).toHaveLength(0)
		expect(anonymous.availableTargets.every(target => target.migrated.yes === 0n && target.migrated.no === 0n && target.migrated.invalid === 0n)).toBe(true)

		const context = await loadForkMigrationContext(client, market, account)
		// Only the child universe with a pool can hold migrated shares, so only it is read: once per source outcome, for this account.
		expect(migratedReads.map(read => [read.fromId & 0xffn, read.universeId, read.account])).toEqual([
			[0n, yesUniverse, account],
			[1n, yesUniverse, account],
			[2n, yesUniverse, account],
		])
		const yesTarget = context.availableTargets.find(target => target.outcomeIndex === 1n)
		if (yesTarget === undefined) throw new Error('Missing Yes child universe')
		expect(yesTarget.migrated).toEqual({ invalid: 0n, yes: 5n, no: 0n })
		expect(largestMigratedShares(context.availableTargets)).toEqual({ invalid: 0n, yes: 5n, no: 0n })
		// Migrating the same Yes balance there again would move nothing; a larger balance has new shares to migrate.
		expect(targetMigrationComplete(yesTarget, 'YES', 5n)).toBe(true)
		expect(targetMigrationComplete(yesTarget, 'YES', 6n)).toBe(false)
		expect(targetMigrationComplete(yesTarget, 'NO', 5n)).toBe(false)
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
