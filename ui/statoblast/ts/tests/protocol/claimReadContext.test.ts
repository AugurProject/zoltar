import { expect, test } from 'bun:test'
import { getAddress, keccak256, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { buildCarryMerkleMountainRangeProof, hashCarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { loadForkCarriedEscalationDepositsFromParentSnapshot } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import { createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const parent = getAddress('0x0000000000000000000000000000000000000001')
const game = getAddress('0x0000000000000000000000000000000000000002')
const child = getAddress('0x0000000000000000000000000000000000000003')
const hash = keccak256('0x01')
const replacement = keccak256('0x02')

function emptyCarryResponse(functionName: string) {
	if (functionName === 'escalationGame') return game
	if (functionName === 'forkContinuation') return false
	if (functionName === 'getOutcomeState') return { currentCarryRoot: zeroHash, currentLeafCount: 0n, currentNullifierRoot: zeroHash, localHeadNodeId: 0n, snapshotLeafCount: 0n, snapshotPeaks: Array.from({ length: 64 }, () => zeroHash) }
	if (functionName === 'getCarryLeafPageByOutcome') return [[], 0n]
	if (functionName === 'getProofConsumedCarriedDepositIndexesByOutcome') return []
	throw new Error(`Unexpected read: ${functionName}`)
}

const load = (client: Parameters<typeof loadForkCarriedEscalationDepositsFromParentSnapshot>[0]) => loadForkCarriedEscalationDepositsFromParentSnapshot(client, child, parent, 'yes', parent)

test('claim discovery follows empty consumed-node pages to the oldest live leaf', async () => {
	const leaf = { amountAttoRep: 10n, cumulativeAmountAttoRep: 10n, depositor: parent, parentDepositIndex: 0n, sourceNodeId: 1n }
	const leafHashes = Array.from({ length: 32 }, (_, index) => (index === 0 ? hashCarryLeaf(leaf, 1) : zeroHash))
	const root = buildCarryMerkleMountainRangeProof(leafHashes, 0).root
	const cursors: bigint[] = []
	const client = {
		getBlockNumber: async () => 1n,
		getBlock: async () => ({ number: 1n, hash }),
		readContract: createReadContractStub(async request => {
			switch (request.functionName) {
				case 'getOutcomeState':
					return { currentCarryRoot: root, currentLeafCount: 32n, currentNullifierRoot: zeroHash, localHeadNodeId: request.address === game ? 32n : 0n, snapshotLeafCount: request.address === child ? 32n : 0n, snapshotPeaks: Array.from({ length: 64 }, (_, index) => (index === 5 ? root : zeroHash)) }
				case 'getCarryLeafPageByOutcome': {
					const cursor = request.args?.[1]
					if (typeof cursor !== 'bigint') throw new Error('Missing carry page cursor')
					expect(request.args?.[2]).toBe(30n)
					cursors.push(cursor)
					return cursor === 0n ? [[], 2n] : [[leaf], 0n]
				}
				case 'nodes': {
					const nodeId = request.args?.[0]
					if (typeof nodeId !== 'bigint') throw new Error('Missing node id')
					return [nodeId - 1n, parent, 1, 10n, nodeId - 1n, nodeId * 10n, nodeId - 1n]
				}
				case 'securityPool':
				case 'securityPoolForker':
					return parent
				case 'isEscalationDepositClaimedDirectly':
					return false
				case 'getClaimCheckpointProgress':
					return [game, 9n, false, false]
				default:
					return emptyCarryResponse(request.functionName)
			}
		}),
	}
	await expect(load(client)).resolves.toMatchObject([{ parentDepositIndex: 0n, claimIdentity: { leafIndex: 0n, snapshotLeafCount: 32n } }])
	expect(cursors).toEqual([0n, 2n])
})

for (const mode of ['stable', 'reorg', 'continuous reorg', 'provider error', 'bad reconstruction after reorg'] as const)
	test(`claim reads bracket one memoized block snapshot (${mode})`, async () => {
		let anchors = 0
		let requests = 0
		let attempts = 0
		const keys = new Set<string>()
		const client = {
			getBlockNumber: async () => BigInt(++attempts),
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
				anchors++
				const changed = (mode === 'continuous reorg' && anchors % 2 === 0) || (['reorg', 'bad reconstruction after reorg'].includes(mode) && anchors === 2)
				return { number: blockNumber, hash: changed ? replacement : hash }
			},
			readContract: createReadContractStub(async parameters => {
				requests++
				expect(parameters.blockNumber).toBe(BigInt(attempts))
				const key = `${parameters.blockNumber}:${parameters.address}:${parameters.functionName}:${String(parameters.args)}`
				expect(keys.has(key)).toBe(false)
				keys.add(key)
				if (mode === 'provider error') throw new Error('RPC disconnected')
				if (mode === 'bad reconstruction after reorg' && attempts === 1 && parameters.address === child && parameters.functionName === 'getOutcomeState') return { snapshotLeafCount: 1n, snapshotPeaks: [] }
				return emptyCarryResponse(parameters.functionName)
			}),
		}
		const result = load(client)
		if (mode === 'continuous reorg' || mode === 'provider error') await expect(result).rejects.toThrow(mode === 'continuous reorg' ? 'changed repeatedly' : 'RPC disconnected')
		else await expect(result).resolves.toEqual([])
		const expectedAttempts = mode === 'stable' || mode === 'provider error' ? 1 : 2
		expect(requests).toBe(mode === 'provider error' ? 1 : expectedAttempts * 7)
		expect(attempts).toBe(expectedAttempts)
		expect(anchors).toBe(expectedAttempts * 2)
	})

for (const hash of [undefined, zeroHash, '0x01'] as const)
	test(`unverifiable anchors stop before contract reads (${hash})`, async () => {
		let reads = 0
		const client = {
			getBlockNumber: async () => 1n,
			getBlock: async () => ({ number: 1n, hash }),
			readContract: createReadContractStub(async () => {
				reads++
				return true
			}),
		}
		await expect(load(client)).rejects.toThrow('anchor is unavailable')
		expect(reads).toBe(0)
	})

test('separate claim requests never reuse mutable cached results', async () => {
	let reads = 0
	const client = {
		getBlockNumber: async () => 1n,
		getBlock: async () => ({ number: 1n, hash }),
		readContract: createReadContractStub(async request => {
			reads++
			return emptyCarryResponse(request.functionName)
		}),
	}
	await load(client)
	await load(client)
	expect(reads).toBe(14)
})
