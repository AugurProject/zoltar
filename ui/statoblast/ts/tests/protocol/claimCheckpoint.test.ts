import { expect, test } from 'bun:test'
import { hashCarryLeaf, buildCarryMerkleMountainRangeProof } from '@zoltar/core-shared/evm/carryProof'
import { decodeFunctionData, encodeAbiParameters, keccak256, getAddress, zeroAddress, zeroHash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { loadForkCarriedEscalationDepositsFromParentSnapshot, prepareForkClaimCheckpoint } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as claimArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient, createReadContractStub, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const parent = getAddress('0x0000000000000000000000000000000000000001')
const game = getAddress('0x0000000000000000000000000000000000000002')
const child = getAddress('0x0000000000000000000000000000000000000003')
const owner = getAddress('0x0000000000000000000000000000000000000004')
const leaf = { amountAttoRep: 10n, cumulativeAmountAttoRep: 20n, depositor: owner, parentDepositIndex: 5n, sourceNodeId: 2n }

const snapshotRoot = keccak256(encodeAbiParameters([{ type: 'uint256' }], [777n]))
const snapshotPeaks = Array.from({ length: 64 }, (_, index) => (index === 1 ? snapshotRoot : zeroHash))
const identity = { ...leaf, escalationGame: child, outcome: 'yes' as const, leafIndex: 1n, snapshotRoot, snapshotLeafCount: 2n }
const _proof = { ...leaf, leafIndex: 1n, merkleMountainRangePeakIndex: 0n, merkleMountainRangeSiblings: [], nullifierSiblings: [] }
function batchReads(client: ReturnType<typeof asWriteClient>) {
	return Object.assign(client, {
		getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: snapshotRoot, timestamp: 1n, transactions: [] }),
		multicall: createMulticallStub(async request => {
			expect(request.allowFailure).toBe(false)
			return await Promise.all(request.contracts.map(contract => client.readContract({ ...contract, blockNumber: request.blockNumber })))
		}),
	})
}

/** A wallet that records each transaction's calldata and reads the child escalation game's snapshot before `readCheckpoint` answers the rest. */
function createChildGameWriteClient(sent: Hex[], readCheckpoint: NonNullable<Parameters<typeof createMockWriteClient>[1]>) {
	return createMockWriteClient(
		request => {
			if (request.data !== undefined) sent.push(request.data)
		},
		async request => {
			if (request.functionName === 'universeId') return 1n
			if (request.functionName === 'escalationGame') return child
			if (request.functionName === 'getOutcomeState') return { snapshotLeafCount: 2n, snapshotPeaks }
			return await readCheckpoint(request)
		},
	)
}

for (const mode of ['unprepared', 'ready', 'corrupt snapshot'] as const)
	test(`authenticates the historical index before loading claim readiness (${mode})`, async () => {
		const ready = mode === 'ready'
		let allocations = 0
		const calls = new Set<string>()
		const first = { ...leaf, depositor: parent, parentDepositIndex: 4n, cumulativeAmountAttoRep: 10n, sourceNodeId: 1n }
		const readContract = createReadContractStub(async request => {
			expect(request.blockNumber).toBe(1n)
			const key = `${request.address}:${request.functionName}:${String(request.args)}`
			expect(calls.has(key)).toBe(false)
			calls.add(key)
			switch (request.functionName) {
				case 'escalationGame':
					return game
				case 'forkContinuation':
					return false
				case 'getOutcomeState':
					if (request.address === child) {
						const root = buildCarryMerkleMountainRangeProof([hashCarryLeaf(first, 1), hashCarryLeaf(leaf, 1)], 0).root
						const snapshotPeak = mode === 'corrupt snapshot' ? zeroHash : root
						return { snapshotLeafCount: 2n, snapshotPeaks: Array.from({ length: 64 }, (_, index) => (index === 1 ? snapshotPeak : zeroHash)) }
					}
					return { currentCarryRoot: zeroHash, currentLeafCount: 2n, currentNullifierRoot: zeroHash, localHeadNodeId: 2n, snapshotLeafCount: 0n }
				case 'getCarryLeafPageByOutcome':
					return [[leaf, first], 0n]
				case 'getProofConsumedCarriedDepositIndexesByOutcome':
					return []
				case 'nodes':
					return request.args?.[0] === 2n ? [1n, owner, 1, 10n, 5n, 20n, 1n] : [0n, parent, 1, 10n, 4n, 10n, 0n]
				case 'getClaimCheckpointProgress':
					expect(request.address).toBe(child)
					expect(request.args).toEqual([1, 10n, 20n, 1n])
					return [ready ? zeroAddress : game, ready ? 0n : 9n, false, ready]
				case 'getInheritedClaimAllocation':
					allocations += 1
					return { sourceAmountAttoRep: 10n, retainedAmountAttoRep: 4n, rewardAmountAttoRep: 5n, retainedCumulativeAttoRep: 6n }
				default:
					throw new Error(`Unexpected ${request.functionName}`)
			}
		})
		const loading = loadForkCarriedEscalationDepositsFromParentSnapshot({ readContract, getBlockNumber: async () => 1n, getBlock: async () => ({ number: 1n, hash: snapshotRoot, timestamp: 1n }) }, child, parent, 'yes', owner)
		if (mode === 'corrupt snapshot') {
			await expect(loading).rejects.toThrow('snapshot root')
			expect(allocations).toBe(0)
			return
		}
		const [deposit] = await loading
		expect(deposit?.claimIdentity).toMatchObject({ escalationGame: child, leafIndex: 1n, snapshotLeafCount: 2n, amountAttoRep: 10n, cumulativeAmountAttoRep: 20n, depositor: owner, parentDepositIndex: 5n })
		expect(deposit).toMatchObject({ parentDepositIndex: 5n, claimCheckpoint: { ready, complete: false } })
		expect(allocations).toBe(ready ? 1 : 0)
		expect(deposit?.claimAllocation?.retainedAmountAttoRep).toBe(ready ? 4n : undefined)
	})

test('one checkpoint action processes at most eight steps and never submits a settlement', async () => {
	const sent: Hex[] = []
	const client = asWriteClient(
		createChildGameWriteClient(sent, async request => {
			if (request.functionName === 'getClaimCheckpointProgress') return [game, 0n, false, false]
			if (request.functionName === 'getClaimCheckpointState') return [false, zeroHash, zeroAddress, { startAttoRep: 10n, endAttoRep: 20n, rewardStartAttoRep: 10n, rewardEndAttoRep: 20n }]
			if (request.functionName === 'getClaimCheckpointWitnessSegment') return [zeroAddress, zeroHash, 0n, 0n]
			throw new Error(`Unexpected ${request.functionName}`)
		}),
	)
	await prepareForkClaimCheckpoint(Object.assign(batchReads(client), { getBlockNumber: async () => 1n }), parent, identity)
	expect(sent).toHaveLength(1)
	const data = sent[0]
	if (data === undefined) throw new Error('Missing checkpoint transaction')
	expect(decodeFunctionData({ abi: claimArtifact.abi, data })).toMatchObject({ functionName: 'processClaimCheckpoint', args: [1n, 10n, 20n, 1n, 8n, zeroHash, []] })
})

for (const mode of ['apply', 'refresh', 'complete', 'changing'] as const)
	test(`revalidates bounded witnesses before the only preparation transaction (${mode})`, async () => {
		const sent: Hex[] = []
		const titles: (string | undefined)[] = []
		const transform = { consumedBeforeAttoRep: 1n }
		const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1, 10n, 20n, 1n]))
		const commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [child, claimId, zeroHash, 1n]))
		let block = 0n
		let transformReads = 0
		const client = Object.assign(
			asWriteClient(
				createChildGameWriteClient(sent, async request => {
					const changed = mode !== 'apply' && request.blockNumber !== 1n
					if (request.functionName === 'getClaimCheckpointProgress') return mode === 'changing' ? [game, request.blockNumber ?? 0n, false, false] : [changed ? game : zeroAddress, changed ? 0n : 1n, mode === 'complete' && changed, mode === 'complete' && changed]
					if (request.functionName === 'getClaimCheckpointState') return [true, changed ? zeroHash : commitment, zeroAddress, { startAttoRep: 10n, endAttoRep: 20n, rewardStartAttoRep: 10n, rewardEndAttoRep: 20n }]
					if (request.functionName === 'getClaimCheckpointWitnessSegment') return [game, zeroHash, 0n, changed ? 0n : 1n]
					if (request.functionName === 'getClaimIntervalTransform') {
						transformReads++
						expect(request.blockNumber).toBe(1n)
						return [zeroAddress, transform]
					}
					throw new Error(`Unexpected ${request.functionName}`)
				}),
			),
			{
				getBlockNumber: async () => ++block,
				onTransactionPrepared: (presentation: { reviewTitle?: string }) => {
					titles.push(presentation.reviewTitle)
				},
			},
		)
		const pending = prepareForkClaimCheckpoint(batchReads(client), parent, identity)
		if (mode === 'complete' || mode === 'changing') {
			await expect(pending).rejects.toThrow(mode === 'complete' ? 'complete' : 'changed')
			expect(sent).toHaveLength(0)
			return
		}
		await pending
		expect(transformReads).toBe(1)
		expect(sent).toHaveLength(1)
		expect(titles).toEqual(['Prepare inherited claim'])
		const data = sent[0]
		if (data === undefined) throw new Error('Missing transaction')
		expect(decodeFunctionData({ abi: claimArtifact.abi, data })).toMatchObject({ functionName: 'processClaimCheckpoint', args: [1n, 10n, 20n, 1n, 8n, zeroHash, mode === 'apply' ? [transform] : []] })
	})

for (const _mode of [
	'success',
	'simulation failure',
	'over budget',
	'wrong proof',
	'changed snapshot',
	'more preparation',
	'stale once',
	'stale twice',
	'wrong refreshed proof',
	'ready after refresh',
	'consumed after refresh',
	'send failure',
	'masked stale',
	'masked unrelated',
	'masked ready',
	'masked consumed',
] as const)
	test('finishes a canonical nearly prepared parent only when total settlement transactions are saved', async () => {
		const source = getAddress('0x0000000000000000000000000000000000000005')
		const transform = { consumedBeforeAttoRep: 1n }
		const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1, 10n, 20n, 1n]))
		const commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [game, claimId, zeroHash, 1n]))
		const sent: { to?: string | null; data?: Hex }[] = []
		const client = Object.assign(
			batchReads(
				asWriteClient(
					createMockWriteClient(
						request => sent.push(request),
						async request => {
							if (request.functionName === 'universeId') return 1n
							if (request.functionName === 'escalationGame') return child
							if (request.functionName === 'getOutcomeState') return { snapshotLeafCount: 2n, snapshotPeaks }
							if (request.functionName === 'isClaimHistoryFrozen') return request.address === source
							if (request.functionName === 'getClaimCheckpointProgress') return [zeroAddress, request.address === child ? 32n : 1n, false, request.address === game]
							if (request.functionName === 'getClaimCheckpointState') return [true, request.address === game ? commitment : zeroHash, zeroAddress, { startAttoRep: 10n, endAttoRep: 20n, rewardStartAttoRep: 10n, rewardEndAttoRep: 20n }]
							if (request.functionName === 'getClaimCheckpointWitnessSegment') return [source, zeroHash, 0n, 1n]
							if (request.functionName === 'getClaimIntervalTransform') {
								if (request.address === child) return [game, transform]
								if (request.address === game) return [source, transform]
								return [zeroAddress, transform]
							}
							throw new Error(`Unexpected ${request.functionName}`)
						},
					),
				),
			),
			{ getBlockNumber: async () => 1n },
		)
		await prepareForkClaimCheckpoint(client, parent, identity)
		expect(sent).toHaveLength(1)
		expect(sent[0]?.to?.toLowerCase()).toBe(game.toLowerCase())
		const data = sent[0]?.data
		if (data === undefined) throw new Error('Missing parent checkpoint transaction')
		expect(decodeFunctionData({ abi: claimArtifact.abi, data })).toMatchObject({ functionName: 'processClaimCheckpoint', args: [1n, 10n, 20n, 1n, 8n, zeroHash, [transform]] })
	})
