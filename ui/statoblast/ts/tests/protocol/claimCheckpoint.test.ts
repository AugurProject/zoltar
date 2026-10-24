import { statoblast_Multicall3_Multicall3 as multicallArtifact } from '@zoltar/ui-core-shared/contractArtifact.js'
import { expect, test } from 'bun:test'
import { hashCarryLeaf, buildCarryMerkleMountainRangeProof } from '@zoltar/core-shared/evm/carryProof'
import { concatHex, decodeFunctionData, encodeAbiParameters, keccak256, getAddress, zeroAddress, zeroHash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { loadForkCarriedEscalationDepositsFromParentSnapshot, prepareForkClaimCheckpoint, prepareAndSettleForkClaim } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as claimArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient, createReadContractStub, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const parent = getAddress('0x0000000000000000000000000000000000000001')
const game = getAddress('0x0000000000000000000000000000000000000002')
const child = getAddress('0x0000000000000000000000000000000000000003')
const owner = getAddress('0x0000000000000000000000000000000000000004')
const leaf = { amountAttoRep: 10n, cumulativeAmountAttoRep: 20n, depositor: owner, parentDepositIndex: 5n, sourceNodeId: 2n }

const snapshotRoot = keccak256(encodeAbiParameters([{ type: 'uint256' }], [777n]))
const snapshotPeaks = Array.from({ length: 64 }, (_, index) => (index === 1 ? snapshotRoot : zeroHash))
const identity = { ...leaf, escalationGame: child, outcome: 'yes' as const, leafIndex: 1n, snapshotRoot, snapshotLeafCount: 2n }
const proof = { ...leaf, leafIndex: 1n, merkleMountainRangePeakIndex: 0n, merkleMountainRangeSiblings: [], nullifierSiblings: [] }
function batchReads(client: ReturnType<typeof asWriteClient>) {
	return Object.assign(client, {
		getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: snapshotRoot, timestamp: 1n, transactions: [] }),
		multicall: createMulticallStub(async request => {
			expect(request.allowFailure).toBe(false)
			return await Promise.all(request.contracts.map(contract => client.readContract({ ...contract, blockNumber: request.blockNumber })))
		}),
	})
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
		createMockWriteClient(
			request => {
				if (request.data !== undefined) sent.push(request.data)
			},
			async request => {
				if (request.functionName === 'universeId') return 1n
				if (request.functionName === 'escalationGame') return child
				if (request.functionName === 'getOutcomeState') return { snapshotLeafCount: 2n, snapshotPeaks }
				if (request.functionName === 'getClaimCheckpointProgress') return [game, 0n, false, false]
				if (request.functionName === 'getClaimCheckpointState') return [false, zeroHash, zeroAddress, { startAttoRep: 10n, endAttoRep: 20n, rewardStartAttoRep: 10n, rewardEndAttoRep: 20n }]
				if (request.functionName === 'getClaimCheckpointWitnessSegment') return [zeroAddress, zeroHash, 0n, 0n]
				throw new Error(`Unexpected ${request.functionName}`)
			},
		),
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
		const transform = { repBeforeAttoRep: 20n, repRemainingAttoRep: 15n, consumedBeforeAttoRep: 1n }
		const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1, 10n, 20n, 1n]))
		const commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [child, claimId, zeroHash, 20n, 15n, 1n]))
		let block = 0n
		let transformReads = 0
		const client = Object.assign(
			asWriteClient(
				createMockWriteClient(
					request => {
						if (request.data !== undefined) sent.push(request.data)
					},
					async request => {
						if (request.functionName === 'universeId') return 1n
						if (request.functionName === 'escalationGame') return child
						if (request.functionName === 'getOutcomeState') return { snapshotLeafCount: 2n, snapshotPeaks }
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
					},
				),
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

for (const mode of [
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
	test(`combined final preparation and pool settlement: ${mode}`, async () => {
		const sent: { to?: string | null; data?: Hex }[] = []
		let simulations = 0
		let rebuilds = 0
		let diagnostics = 0
		const transform = { repBeforeAttoRep: 20n, repRemainingAttoRep: 15n, consumedBeforeAttoRep: 1n }
		const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1, 10n, 20n, 1n]))
		const commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [child, claimId, zeroHash, 20n, 15n, 1n]))
		const client = Object.assign(
			batchReads(
				asWriteClient(
					createMockWriteClient(
						request => {
							sent.push(request)
							if (mode === 'send failure') throw new Error('Bad nullifier proof')
						},
						async request => {
							if (request.functionName === 'universeId') return 1n
							if (request.functionName === 'escalationGame') return child
							if (request.functionName === 'getOutcomeState') return { snapshotLeafCount: mode === 'changed snapshot' ? 3n : 2n, snapshotPeaks }
							if (request.functionName === 'getClaimCheckpointProgress') return [zeroAddress, mode === 'more preparation' ? 9n : 1n, false, (mode === 'ready after refresh' && rebuilds > 0) || (mode === 'masked ready' && diagnostics > 0)]
							if (request.functionName === 'getClaimCheckpointState') return [true, commitment, zeroAddress, { startAttoRep: 10n, endAttoRep: 20n, rewardStartAttoRep: 10n, rewardEndAttoRep: 20n }]
							if (request.functionName === 'getClaimCheckpointWitnessSegment') return [game, zeroHash, 0n, 1n]
							if (request.functionName === 'getClaimIntervalTransform') return [zeroAddress, transform]
							throw new Error(`Unexpected ${request.functionName}`)
						},
					),
				),
			),
			{
				getBlockNumber: async () => 1n,
				simulateContract: async (request: { args: readonly [readonly { allowFailure: boolean }[]] }) => {
					if (request.args[0].some(call => call.allowFailure)) {
						diagnostics++
						const reason = mode === 'masked unrelated' ? 'Bad carry proof' : 'Bad nullifier proof'
						return {
							result: [
								{ success: mode !== 'masked ready', returnData: '0x' },
								{ success: false, returnData: concatHex(['0x08c379a0', encodeAbiParameters([{ type: 'string' }], [mode === 'masked consumed' ? 'Parent deposit claimed' : reason])]) },
							],
						}
					}
					simulations++
					if (mode.startsWith('masked') && simulations === 1) throw new Error('execution reverted: Multicall3: call failed')
					if (mode === 'simulation failure') throw new Error('RPC disconnected')
					if (mode === 'stale twice' || (['stale once', 'wrong refreshed proof', 'ready after refresh', 'consumed after refresh'].includes(mode) && simulations === 1)) throw new Error('execution reverted: Bad nullifier proof')
				},
				estimateGas: async () => (mode === 'over budget' ? 5_000_001n : 500_000n),
			},
		)
		const pending = prepareAndSettleForkClaim(client, parent, identity, mode === 'wrong proof' ? { ...proof, depositor: game } : proof, async () => {
			rebuilds++
			if (mode === 'consumed after refresh') throw new Error('Parent deposit #5 is already settled.')
			return mode === 'wrong refreshed proof' ? { ...proof, amountAttoRep: 11n } : { ...proof, nullifierSiblings: [zeroHash] }
		})
		if (mode !== 'success' && mode !== 'stale once' && mode !== 'masked stale') {
			await expect(pending).rejects.toThrow(
				{
					'simulation failure': 'RPC disconnected',
					'masked unrelated': 'Multicall3: call failed',
					'masked ready': 'preparation is complete',
					'masked consumed': 'already settled',
					'stale twice': 'changed again',
					'wrong refreshed proof': 'does not match',
					'ready after refresh': 'preparation is complete',
					'consumed after refresh': 'already settled',
					'send failure': 'Bad nullifier proof',
					'over budget': 'transaction budget',
					'wrong proof': 'does not match',
					'changed snapshot': 'snapshot changed',
					'more preparation': 'More claim preparation',
				}[mode],
			)
			expect(sent).toHaveLength(mode === 'send failure' ? 1 : 0)
			expect(rebuilds).toBe(['stale twice', 'wrong refreshed proof', 'ready after refresh', 'consumed after refresh'].includes(mode) ? 1 : 0)
			const expectedSimulations = ['wrong proof', 'changed snapshot', 'more preparation'].includes(mode) ? 0 : 1
			expect(simulations).toBe(mode === 'stale twice' ? 2 : expectedSimulations)
			return
		}
		await pending
		expect(simulations).toBe(mode === 'stale once' || mode === 'masked stale' ? 2 : 1)
		expect(diagnostics).toBe(mode === 'masked stale' ? 1 : 0)
		expect(rebuilds).toBe(mode === 'stale once' || mode === 'masked stale' ? 1 : 0)
		expect(sent).toHaveLength(1)
		const transaction = sent[0]
		if (transaction?.data === undefined) throw new Error('Expected atomic transaction')
		const decoded = decodeFunctionData({ abi: multicallArtifact.abi, data: transaction.data })
		expect(decoded.functionName).toBe('aggregate3')
		if (decoded.functionName !== 'aggregate3') throw new Error('Expected aggregate3')
		const [calls] = decoded.args
		expect(calls).toHaveLength(2)
		const [prepare, settle] = calls
		if (prepare === undefined || settle === undefined) throw new Error('Missing atomic calls')
		expect(prepare.target.toLowerCase()).toBe(child.toLowerCase())
		expect(settle.target.toLowerCase()).toBe(parent.toLowerCase())
		expect(calls.every(call => !call.allowFailure)).toBe(true)
		expect(decodeFunctionData({ abi: claimArtifact.abi, data: prepare.callData }).functionName).toBe('processClaimCheckpoint')
		expect(decodeFunctionData({ abi: poolArtifact.abi, data: settle.callData })).toMatchObject({ functionName: 'withdrawForkedEscalationDeposits', args: [1n, [{ depositor: owner, leafIndex: 1n }]] })
	})

test('finishes a canonical nearly prepared parent only when total settlement transactions are saved', async () => {
	const source = getAddress('0x0000000000000000000000000000000000000005')
	const transform = { repBeforeAttoRep: 20n, repRemainingAttoRep: 15n, consumedBeforeAttoRep: 1n }
	const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1, 10n, 20n, 1n]))
	const commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [game, claimId, zeroHash, 20n, 15n, 1n]))
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
