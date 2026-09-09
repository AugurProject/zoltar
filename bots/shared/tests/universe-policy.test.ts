import { expect, test } from 'bun:test'
import { createPublicClient, custom, mainnet, getAddress, zeroAddress } from '../src/ethereum.ts'
import { approvedUniverseRepTokens, loadUniverseTree, parseApprovedUniverses, validateApprovedUniverseSelection, type UniverseIdentity } from '../src/monitoring/universe-policy.ts'

function universe(id: bigint, parentId: bigint | undefined): UniverseIdentity {
	return { id, parentId, outcomeIndex: parentId === undefined ? undefined : id, forkTime: 0n, forkQuestionId: 0n, repToken: getAddress(`0x${(id + 1n).toString(16).padStart(40, '0')}`) }
}
const tree = [universe(0n, undefined), universe(1n, 0n), universe(2n, 0n), universe(3n, 1n), universe(4n, 2n)]

test('requires explicit approval even for root REP and revokes approval without granting discovery trust', () => {
	expect(approvedUniverseRepTokens(tree, [])).toEqual([])
	expect(approvedUniverseRepTokens(tree, [0n, 1n])).toEqual([universe(0n, undefined).repToken, universe(1n, 0n).repToken])
	expect(approvedUniverseRepTokens(tree, [1n])).toEqual([universe(1n, 0n).repToken])
	expect(approvedUniverseRepTokens(tree, [])).toEqual([])
})

test('rejects unknown universes and competing direct or descendant fork outcomes', () => {
	expect(() => approvedUniverseRepTokens(tree, [99n])).toThrow('not present')
	expect(() => approvedUniverseRepTokens(tree, [1n, 2n])).toThrow('only one truthful child')
	expect(() => approvedUniverseRepTokens(tree, [3n, 4n])).toThrow('only one truthful child')
	expect(() => validateApprovedUniverseSelection([universe(1n, 2n), universe(2n, 1n)], [1n])).toThrow('cyclic')
	expect(() => validateApprovedUniverseSelection([universe(1n, 2n)], [1n])).toThrow('unknown parent')
})

test('both bot configuration boundaries use strict uint248 universe identifiers', () => {
	expect(parseApprovedUniverses(['0', '1', '1'])).toEqual([0n, 1n])
	for (const invalid of [undefined, ['-1'], ['01'], [0], ['0x1'], [(2n ** 248n).toString()]]) expect(() => parseApprovedUniverses(invalid)).toThrow()
})

function registryClient(invalidChild = false) {
	const base = createPublicClient({
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	})
	const reads: bigint[] = []
	const client = new Proxy(base, {
		get(target, property) {
			if (property !== 'readContract') return Reflect.get(target, property)
			return async (parameters: { functionName: string; blockNumber: bigint; args: readonly bigint[] }) => {
				reads.push(parameters.blockNumber)
				const root = { forkQuestionId: 1n, forkTime: 10n, forkingOutcomeIndex: 0n, parentUniverseId: 0n, reputationToken: universe(0n, undefined).repToken }
				if (parameters.functionName === 'universes') return root
				if (parameters.functionName === 'getDeployedChildUniverses' && parameters.args[0] === 0n) return [[1n], [1n], [{ ...root, forkTime: 0n, forkingOutcomeIndex: 1n, reputationToken: invalidChild ? zeroAddress : universe(1n, 0n).repToken }]]
				if (parameters.functionName === 'getDeployedChildUniverses') return [[], [], []]
				throw new Error('Unexpected contract read')
			}
		},
	})
	return { client, reads }
}

test('discovers child REP from one canonical registry snapshot without granting approval', async () => {
	const { client, reads } = registryClient()
	const universes = await loadUniverseTree(client, universe(10n, undefined).repToken, 42n)
	expect(universes.map(value => [value.id, value.parentId])).toEqual([
		[0n, undefined],
		[1n, 0n],
	])
	expect(approvedUniverseRepTokens(universes, [])).toEqual([])
	expect(approvedUniverseRepTokens(universes, [1n])).toEqual([universe(1n, 0n).repToken])
	expect(reads).toEqual([42n, 42n, 42n])
})

test('fails discovery when a registered child has no REP token', async () => {
	const { client } = registryClient(true)
	await expect(loadUniverseTree(client, universe(10n, undefined).repToken, 42n)).rejects.toThrow('invalid child universe identity')
})
