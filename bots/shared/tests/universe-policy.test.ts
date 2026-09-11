import { expect, test } from 'bun:test'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { createPublicClient, getAddress, zeroAddress } from '../src/ethereum.ts'
import { custom } from '../src/ethereum/rpc-transport.ts'
import { approvedUniverseRepTokens, loadUniverseTree, loadUniverseTreeBatched, parseApprovedUniverses, validateApprovedUniverseSelection, type UniverseIdentity } from '../src/monitoring/universe-policy.ts'

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

function batchedRegistryClient(childrenOfRoot: number) {
	const base = createPublicClient({
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	})
	const batches: { blockNumber: bigint | undefined; calls: readonly string[] }[] = []
	const root = { forkQuestionId: 1n, forkTime: 10n, forkingOutcomeIndex: 0n, parentUniverseId: 0n, reputationToken: universe(0n, undefined).repToken }
	const client = new Proxy(base, {
		get(target, property) {
			if (property !== 'multicall') return Reflect.get(target, property)
			return async (parameters: { blockNumber?: bigint; contracts: readonly { functionName: string; args: readonly bigint[] }[] }) => {
				batches.push({ blockNumber: parameters.blockNumber, calls: parameters.contracts.map(contract => `${contract.functionName}(${contract.args.join(',')})`) })
				return parameters.contracts.map(contract => {
					if (contract.functionName === 'universes') return root
					const [universeId, start] = contract.args
					if (universeId !== 0n || start === undefined || start >= BigInt(childrenOfRoot)) return [[], [], []]
					const ids = Array.from({ length: Math.min(100, childrenOfRoot - Number(start)) }, (_, index) => BigInt(index) + 1n + start)
					return [ids, ids, ids.map(id => ({ ...root, forkTime: 0n, forkingOutcomeIndex: id, reputationToken: universe(id, 0n).repToken }))]
				})
			}
		},
	})
	return { batches, client }
}

test('batched discovery reads the unforked registry in one request and pages wide forks level by level', async () => {
	const multicall3 = universe(20n, undefined).repToken
	const unforked = batchedRegistryClient(0)
	const universes = await loadUniverseTreeBatched(unforked.client, universe(10n, undefined).repToken, 42n, multicall3)
	expect(universes.map(value => value.id)).toEqual([0n])
	expect(unforked.batches).toEqual([{ blockNumber: 42n, calls: ['universes(0)', 'getDeployedChildUniverses(0,0,100)'] }])

	const wide = batchedRegistryClient(150)
	const forked = await loadUniverseTreeBatched(wide.client, universe(10n, undefined).repToken, 42n, multicall3)
	expect(forked).toHaveLength(151)
	expect(forked[150]?.parentId).toBe(0n)
	expect(wide.batches[0]?.calls).toEqual(['universes(0)', 'getDeployedChildUniverses(0,0,100)'])
	// The second level requests the next root page plus every child's first page at once.
	expect(wide.batches[1]?.calls[0]).toBe('getDeployedChildUniverses(0,100,100)')
	expect(wide.batches[1]?.calls).toHaveLength(101)
	expect(wide.batches[2]?.calls).toHaveLength(50)
	expect(wide.batches).toHaveLength(3)
	expect(wide.batches.every(batch => batch.blockNumber === 42n)).toBeTrue()
})
