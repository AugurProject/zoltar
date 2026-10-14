import { expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, RpcError } from '@zoltar/bot-shared/ethereum'
import { loadCarryStorageCandidates } from '../../src/monitoring/carry-proof-storage.ts'

test('an empty discovered graph needs no historical logs or journal', async () => {
	const client = {
		async readContract() {
			throw new Error('Unexpected storage read')
		},
	}
	const result = await loadCarryStorageCandidates(client, [], getAddress('0x0000000000000000000000000000000000000001'), 11000000n, 100)
	expect(result).toEqual([])
})

import { zeroHash, toHex } from '@zoltar/bot-shared/ethereum'
import { carryCommitment } from '../../src/monitoring/carry-proof-index.ts'
import { verifyMerkleMountainRangeProof } from '../support/carry-proof-verification.ts'
import { scanCarryStorage } from '../../src/monitoring/carry-storage-scan.ts'
import { anchor, blockHash, child, forker, grandchild, slot, source, storageFixture, wallet } from './carry-storage-fixture.ts'

function load(fixture: ReturnType<typeof storageFixture>, game = child, limit = 1000) {
	return loadCarryStorageCandidates(fixture.client, [{ pool: fixture.pool(game), escalationGame: game }], wallet, anchor, limit)
}
function scan(fixture: ReturnType<typeof storageFixture>) {
	return scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000 })
}

test('constructs and simulates a carry withdrawal exclusively from anchored storage', async () => {
	const fixture = storageFixture()
	const result = await scan(fixture)
	expect(result.withdrawalPresence).toHaveLength(1)
	expect(result.withdrawals).toHaveLength(1)
	expect(result.withdrawals[0]?.amountToWithdrawAttoRep).toBe('16')
	expect(result.withdrawals[0]?.burnAmountAttoRep).toBe('4')
	expect(fixture.calls.filter(call => call.method === 'eth_call').every(call => call.block === toHex(anchor))).toBeTrue()
	expect(fixture.calls.some(call => call.method === 'eth_getLogs')).toBeFalse()
})

test('uses allocated principal separately from the preserved reward interval', async () => {
	const fixture = storageFixture()
	fixture.setRetainedPrincipal(9n)
	const result = await scan(fixture)
	expect(result.withdrawals[0]?.amountToWithdrawAttoRep).toBe('15')
	expect(result.withdrawals[0]?.burnAmountAttoRep).toBe('4')
	expect(fixture.calls.some(call => call.functionName === 'getInheritedClaimAllocation')).toBeTrue()
})

test('reconstructs repeated forks and skips consumed inherited identities', async () => {
	const fixture = storageFixture()
	const second = slot(source, 1)
	const origin = fixture.games[0]
	const middle = fixture.games[1]
	if (origin === undefined || middle === undefined) throw new Error('Missing fixture games')
	origin.local.push(second)
	middle.inherited.push(second)
	middle.consumed.push(fixture.leaf.leaf.parentDepositIndex)
	fixture.games.push({ game: grandchild, parent: child, inherited: [...middle.inherited], local: [], consumed: [], direct: new Set() })
	const candidates = await load(fixture, grandchild)
	expect(candidates.map(candidate => candidate.parentDepositIndex)).toEqual([second.leaf.parentDepositIndex])
	const candidate = candidates[0]
	if (candidate === undefined || candidate.proof === undefined) throw new Error('Missing candidate proof')
	expect(candidate.claimSourceGame).toBe(source)
	verifyMerkleMountainRangeProof(second.hash, '2', carryCommitment(middle.inherited).root, candidate.proof)
})

test('preserves zero slots for locally consumed leaves', async () => {
	const fixture = storageFixture()
	const origin = fixture.games[0]
	const target = fixture.games[1]
	if (origin === undefined || target === undefined) throw new Error('Missing fixture games')
	const removed = { ...fixture.leaf, hash: zeroHash, consumedLocally: true }
	const second = slot(source, 1)
	origin.local = [removed, second]
	target.inherited = [removed, second]
	const candidates = await load(fixture)
	expect(candidates).toHaveLength(1)
	expect(candidates[0]?.proof?.leafIndex).toBe('1')
	expect(candidates[0]?.proof?.merkleMountainRangeSiblings).toEqual([zeroHash])
})

test('preserves a directly claimed leaf hash while excluding it from wallet claims', async () => {
	const fixture = storageFixture()
	const origin = fixture.games[0]
	if (origin === undefined) throw new Error('Missing source')
	origin.direct.add(fixture.leaf.leaf.parentDepositIndex)
	expect(await load(fixture)).toEqual([])
})

for (const [name, corrupt, error] of [
	['snapshot root', (fixture: ReturnType<typeof storageFixture>) => fixture.setBadSnapshot(), 'snapshot root'],
	['nullifier root', (fixture: ReturnType<typeof storageFixture>) => fixture.setBadNullifier(), 'nullifier root'],
	['node cycle', (fixture: ReturnType<typeof storageFixture>) => fixture.setCycle(), 'cycle'],
] as const)
	test(`rejects an inconsistent ${name}`, async () => {
		const fixture = storageFixture()
		corrupt(fixture)
		await expect(load(fixture)).rejects.toThrow(error)
	})

test('bounds storage traversal and rejects reorgs or mismatched simulated payouts', async () => {
	const fixture = storageFixture()
	await expect(load(fixture, child, 1)).rejects.toThrow('limit')
	fixture.setBadEconomics()
	await expect(scan(fixture)).rejects.toThrow('economics')
	fixture.setBadAnchor()
	await expect(scan(fixture)).rejects.toThrow('canonical')
})

test('matches Statoblast UI reference vectors for multiple MMR peaks and consumed indexes', async () => {
	const fixture = storageFixture()
	const origin = fixture.games[0]
	const target = fixture.games[1]
	if (origin === undefined || target === undefined) throw new Error('Missing fixture games')
	const leaves = Array.from({ length: 3 }, (_, index) => slot(source, index))
	origin.local = leaves
	target.inherited = leaves
	target.consumed.push(fixture.leaf.leaf.parentDepositIndex)
	const candidates = await load(fixture)
	// Reference vectors from ui/statoblastShared/ts/protocol/reportingCarryProof.ts at 707342ba5, with leafIndex as the global MMR slot.
	// Three slot(source, index) leaves, index 0 consumed; hash ABI-encoded bytes32[] nullifier siblings.
	// Keep these fixed so the isolated bot package does not require a UI build.
	expect(
		candidates.map(candidate => {
			if (candidate.proof === undefined) throw new Error('Missing selected proof')
			return {
				parentDepositIndex: candidate.parentDepositIndex,
				leafIndex: candidate.proof.leafIndex,
				merkleMountainRangePeakIndex: candidate.proof.merkleMountainRangePeakIndex,
				merkleMountainRangeSiblings: candidate.proof.merkleMountainRangeSiblings,
				nullifierSiblingsHash: keccak256(encodeAbiParameters([{ type: 'bytes32[]' }], [candidate.proof.nullifierSiblings])),
			}
		}),
	).toEqual([
		{
			parentDepositIndex: '7922816251426433759354395033601',
			leafIndex: '1',
			merkleMountainRangePeakIndex: '1',
			merkleMountainRangeSiblings: ['0xa0ebcd7d728cddad423416b7e319cf69a5e7af4d5702891f3f7b55282b9bb242', '0xe1eea733fcdf27da77be796af99d98288d5a9966e69b65bfb26705f0d1b677b8'],
			nullifierSiblingsHash: '0xa676fe0e06d31936e21d2b993fc1f7903742856f4f7cd9a925a72bf4e67c437f',
		},
		{
			parentDepositIndex: '7922816251426433759354395033602',
			leafIndex: '2',
			merkleMountainRangePeakIndex: '0',
			merkleMountainRangeSiblings: ['0xc408daae22afc1ac502346d55051a1afca1778a34b4b4df97771c07e856b453d'],
			nullifierSiblingsHash: '0xa676fe0e06d31936e21d2b993fc1f7903742856f4f7cd9a925a72bf4e67c437f',
		},
	])
})

test('pages stored leaves without losing known identities', async () => {
	const fixture = storageFixture()
	const origin = fixture.games[0]
	const target = fixture.games[1]
	if (origin === undefined || target === undefined) throw new Error('Missing fixture games')
	const leaves = Array.from({ length: 35 }, (_, index) => slot(source, index))
	// Only the first deposit has a reward; use candidate discovery here to exercise the full page boundary.
	origin.local = leaves
	target.inherited = leaves
	const candidates = await load(fixture)
	expect(candidates).toHaveLength(35)
	expect(candidates.filter(candidate => candidate.proof !== undefined)).toHaveLength(32)
	expect(new Set(candidates.map(candidate => candidate.parentDepositIndex)).size).toBe(35)
	expect(fixture.calls.filter(call => call.functionName === 'getCarryLeafPageByOutcome')).toHaveLength(2)
	const next = await loadCarryStorageCandidates(fixture.client, [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchor + 1n, 1000)
	expect(next.filter(candidate => candidate.proof !== undefined).map(candidate => candidate.parentDepositIndex)).not.toEqual(candidates.filter(candidate => candidate.proof !== undefined).map(candidate => candidate.parentDepositIndex))
})

test('rejects ancestor cycles and observes consumed claims on a fresh storage scan', async () => {
	const fixture = storageFixture()
	const target = fixture.games[1]
	if (target === undefined) throw new Error('Missing target')
	expect(await load(fixture)).toHaveLength(1)
	target.consumed.push(fixture.leaf.leaf.parentDepositIndex)
	expect(await load(fixture)).toHaveLength(0)
	target.parent = child
	await expect(load(fixture)).rejects.toThrow('cycle')
})

test('deep claims remain discoverable while bounded preparation replaces withdrawal simulation', async () => {
	const fixture = storageFixture()
	fixture.setClaimNotReady()
	const result = await scan(fixture)
	expect(result.withdrawals).toEqual([])
	expect(result.withdrawalPresence).toHaveLength(1)
	expect(result.checkpoints).toMatchObject([{ game: child, nextSourceGame: source, pendingSteps: '10' }])
	expect(fixture.calls.some(call => call.functionName === 'getInheritedClaimAllocation' || call.functionName === 'withdrawDeposit')).toBe(false)
})

test('checkpoint presence remains complete beyond the rotating withdrawal proof budget', async () => {
	const fixture = storageFixture()
	const root = fixture.games.find(game => game.game === source)
	const target = fixture.games.find(game => game.game === child)
	if (root === undefined || target === undefined) throw new Error('Missing carry games')
	root.local = Array.from({ length: 60 }, (_, index) => slot(source, index))
	target.inherited = [...root.local]
	fixture.setClaimNotReady()
	const result = await scan(fixture)
	expect(result.withdrawalPresence).toHaveLength(60)
	expect(result.checkpoints).toHaveLength(60)
	expect(result.withdrawals).toEqual([])
})

test('reconstructs pop witnesses from one canonical segment without historical logs', async () => {
	const fixture = storageFixture()
	fixture.setCheckpointApplying()
	const result = await scan(fixture)
	expect(result.checkpoints).toHaveLength(1)
	expect(result.checkpoints[0]?.transforms).toEqual([{ repBeforeAttoRep: 20n.toString(), repRemainingAttoRep: 15n.toString(), consumedBeforeAttoRep: 1n.toString() }])
	expect(result.checkpoints[0]?.baseCommitment).toBe(zeroHash)
	expect(fixture.calls.filter(call => call.functionName === 'getClaimIntervalTransform')).toHaveLength(2)
	expect(fixture.calls.filter(call => call.method === 'eth_call').every(call => call.block === toHex(anchor))).toBeTrue()
	expect(fixture.calls.some(call => call.method === 'eth_getLogs')).toBeFalse()
	fixture.setBadCheckpointCommitment()
	await expect(scan(fixture)).rejects.toThrow('commitment')
})

test('the final bounded batch is simulated together with the authenticated pool withdrawal', async () => {
	const fixture = storageFixture()
	fixture.setCheckpointApplying()
	const multicall3 = fixture.pool(source)
	const result = await scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000, multicall3 })
	expect(result.checkpoints[0]?.settlement).toBe('atomic')
	expect(result.checkpoints[0]?.finalWithdrawal).toMatchObject({ multicall3, proof: { depositor: wallet, leafIndex: '0', amountAttoRep: 10n.toString() } })
	expect(fixture.calls.filter(call => call.functionName === 'aggregate3')).toHaveLength(1)
	expect(result.withdrawals).toEqual([])
	fixture.setAtomicFailure()
	const fallback = await scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000, multicall3 })
	expect(fallback.checkpoints).toHaveLength(1)
	expect(fallback.checkpoints[0]?.settlement).toBe('separate')
	expect(fallback.checkpoints[0]?.finalWithdrawal).toBeUndefined()
	expect(fallback.checkpoints[0]?.transforms).toHaveLength(1)
})

test('an unavailable multicall deployment retains standalone checkpoint preparation', async () => {
	const fixture = storageFixture()
	fixture.setCheckpointApplying()
	fixture.setAtomicResponse('0x')
	const result = await scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000, multicall3: fixture.pool(source) })
	expect(result.checkpoints).toHaveLength(1)
	expect(result.checkpoints[0]?.settlement).toBe('separate')
	expect(result.checkpoints[0]?.finalWithdrawal).toBeUndefined()
	expect(result.checkpoints[0]?.transforms).toHaveLength(1)
})

test('a context-wrapped node revert retains standalone checkpoint preparation', async () => {
	const fixture = storageFixture()
	fixture.setCheckpointApplying()
	fixture.setAtomicFailure(new Error('RPC endpoint rejected the call', { cause: new RpcError('execution reverted: stale atomic withdrawal proof', { code: -32000 }) }))
	const result = await scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000, multicall3: fixture.pool(source) })
	expect(result.checkpoints).toHaveLength(1)
	expect(result.checkpoints[0]?.settlement).toBe('separate')
	expect(result.checkpoints[0]?.finalWithdrawal).toBeUndefined()
	expect(result.checkpoints[0]?.transforms).toHaveLength(1)
})

test.each([new TypeError('Atomic revert decoder invariant failed'), new RpcError('RPC upstream unavailable', { code: -32000 })])('unexpected atomic simulation failure propagates: $message', async error => {
	const fixture = storageFixture()
	fixture.setCheckpointApplying()
	fixture.setAtomicFailure(error)
	await expect(scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000, multicall3: fixture.pool(source) })).rejects.toThrow(error.message)
})

test.each([
	{ label: 'truncated ABI', response: '0x01' as const },
	{
		label: 'missing aggregate calls',
		response: encodeAbiParameters(
			[
				{
					type: 'tuple[]',
					components: [
						{ name: 'success', type: 'bool' },
						{ name: 'returnData', type: 'bytes' },
					],
				},
			],
			[[]],
		),
	},
	{
		label: 'incomplete checkpoint',
		response: encodeAbiParameters(
			[
				{
					type: 'tuple[]',
					components: [
						{ name: 'success', type: 'bool' },
						{ name: 'returnData', type: 'bytes' },
					],
				},
			],
			[
				[
					{ success: true, returnData: encodeAbiParameters([{ type: 'bool' }], [false]) },
					{ success: true, returnData: '0x' },
				],
			],
		),
	},
])('malformed atomic simulation results propagate: $label', async ({ response }) => {
	const fixture = storageFixture()
	fixture.setCheckpointApplying()
	fixture.setAtomicResponse(response)
	await expect(scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000, multicall3: fixture.pool(source) })).rejects.toThrow()
})

test.each([
	{ parentGeneration: 9, shared: true, multicall: false },
	{ parentGeneration: 9, shared: false, multicall: true },
	{ parentGeneration: 17, shared: true, multicall: false },
])('prices forked parent preparation including separate child settlements at depth $parentGeneration, multicall $multicall', async ({ parentGeneration, shared, multicall }) => {
	const fixture = storageFixture()
	const gameAt = (generation: number) => getAddress(toHex(BigInt(generation * 100), { size: 20 }))
	const childGenerations = [parentGeneration + 1, parentGeneration + 2, parentGeneration + 3]
	for (let generation = 3; generation <= parentGeneration; generation++) fixture.games.push({ game: gameAt(generation), parent: gameAt(generation - 1), inherited: [fixture.leaf], local: [], consumed: [], direct: new Set() })
	for (const generation of childGenerations) fixture.games.push({ game: gameAt(generation), parent: gameAt(parentGeneration), inherited: [fixture.leaf], local: [], consumed: [], direct: new Set() })
	for (let generation = 1; generation <= parentGeneration + 3; generation++) {
		fixture.setProgress(gameAt(generation), { nextSourceGame: generation <= 2 ? '0x0000000000000000000000000000000000000000' : gameAt(generation > parentGeneration ? parentGeneration - 1 : generation - 2), pendingSteps: 0n, ready: generation === parentGeneration, complete: false })
		if (generation <= parentGeneration) fixture.setForked(gameAt(generation))
	}
	const result = await scanCarryStorage({
		client: fixture.client,
		escalationGames: childGenerations.map(generation => ({ pool: fixture.pool(gameAt(generation)), escalationGame: gameAt(generation) })),
		wallet,
		anchorBlockNumber: anchor,
		expectedAnchorHash: blockHash,
		securityPoolForker: forker,
		maximumItems: 10000,
		...(multicall ? { multicall3: fixture.pool(source) } : {}),
	})
	expect(result.withdrawalPresence).toHaveLength(3)
	expect(result.withdrawals).toEqual([])
	expect(result.checkpoints).toMatchObject(
		shared
			? [{ game: gameAt(parentGeneration), targetGame: gameAt(parentGeneration + 1), preparationReason: 'shared-ancestor', pool: fixture.pool(gameAt(parentGeneration)) }]
			: childGenerations.map(generation => ({ game: gameAt(generation), targetGame: gameAt(generation), preparationReason: 'required', pool: fixture.pool(gameAt(generation)) })),
	)
	expect(result.checkpoints).toHaveLength(shared ? 1 : 3)
	expect(result.checkpoints[0]?.finalWithdrawal).toBeUndefined()
})

test('one canonical scan shares game economics reads while retaining per-leaf checkpoint transforms', async () => {
	const fixture = storageFixture()
	const root = fixture.games[0]
	const target = fixture.games[1]
	if (root === undefined || target === undefined) throw new Error('Missing carry games')
	const second = slot(source, 1)
	root.local.push(second)
	target.inherited.push(second)
	const result = await scan(fixture)
	expect(result.withdrawals).toHaveLength(2)
	for (const functionName of ['getBindingCapitalAttoRep', 'nonDecisionThresholdAttoRep', 'getEscalationGameEndDate', 'universeId', 'zoltar', 'getForkThresholdAttoRep', 'getForkTime']) expect(fixture.calls.filter(call => call.functionName === functionName)).toHaveLength(1)
	fixture.calls.length = 0
	fixture.setCheckpointApplying()
	const checkpoints = await scan(fixture)
	expect(checkpoints.checkpoints).toHaveLength(2)
	expect(fixture.calls.filter(call => call.functionName === 'getClaimIntervalTransform')).toHaveLength(4)
})

test('without Multicall a 24-step target finishes its one-step parent before preparing the target', async () => {
	const fixture = storageFixture()
	fixture.games.push({ game: grandchild, parent: child, inherited: [fixture.leaf], local: [], consumed: [], direct: new Set() })
	fixture.setCheckpointApplying()
	fixture.setProgress(child, { nextSourceGame: '0x0000000000000000000000000000000000000000', pendingSteps: 1n, ready: true, complete: false })
	fixture.setProgress(grandchild, { nextSourceGame: '0x0000000000000000000000000000000000000000', pendingSteps: 24n, ready: false, complete: false })
	const result = await scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(grandchild), escalationGame: grandchild }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, securityPoolForker: forker, maximumItems: 1000 })
	expect(result.checkpoints).toMatchObject([{ game: child, targetGame: grandchild, preparationReason: 'finishing-parent', settlement: 'separate', pendingSteps: '1' }])
	expect(result.checkpoints[0]?.finalWithdrawal).toBeUndefined()
	expect(fixture.calls.some(call => call.functionName === 'aggregate3')).toBeFalse()
})
