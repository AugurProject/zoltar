import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
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

import { toHex } from '@zoltar/bot-shared/ethereum'
import { carryCommitment, hashCarryLeaf } from '../../src/monitoring/carry-proof-index.ts'
import { verifyMerkleMountainRangeProof } from '../support/carry-proof-verification.ts'
import { scanCarryStorage } from '../../src/monitoring/carry-storage-scan.ts'
import { address, anchor, blockHash, child, forker, grandchild, slot, source, storageFixture, wallet } from './carry-storage-fixture.ts'

function load(fixture: ReturnType<typeof storageFixture>, game = child, limit = 1000) {
	return loadCarryStorageCandidates(fixture.client, [{ pool: fixture.pool(game), escalationGame: game }], wallet, anchor, limit)
}
function scan(fixture: ReturnType<typeof storageFixture>) {
	return scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(child), escalationGame: child }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, questionForker: forker, maximumItems: 1000 })
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

test('uses authenticated principal and preserves the reward interval', async () => {
	const fixture = storageFixture()
	const result = await scan(fixture)
	expect(result.withdrawals[0]?.amountToWithdrawAttoRep).toBe('16')
	expect(result.withdrawals[0]?.burnAmountAttoRep).toBe('4')
	expect(fixture.calls.some(call => call.functionName === 'getInheritedClaimAllocation')).toBeFalse()
})

test('reconstructs repeated forks and skips inherited identities consumed by the claiming game', async () => {
	const fixture = storageFixture()
	const second = slot(source, 1)
	const origin = fixture.games[0]
	const middle = fixture.games[1]
	if (origin === undefined || middle === undefined) throw new Error('Missing fixture games')
	origin.local.push(second)
	middle.inherited.push(second)
	fixture.games.push({ game: grandchild, parent: child, inherited: [...middle.inherited], local: [], consumed: [fixture.leaf.leaf.parentDepositIndex] })
	const candidates = await load(fixture, grandchild)
	expect(candidates.map(candidate => candidate.parentDepositIndex)).toEqual([second.leaf.parentDepositIndex])
	const candidate = candidates[0]
	if (candidate === undefined || candidate.proof === undefined) throw new Error('Missing candidate proof')
	expect(candidate.claimSourceGame).toBe(source)
	verifyMerkleMountainRangeProof(second.hash, '2', carryCommitment(middle.inherited).root, candidate.proof)
})

test('keeps consumed source leaves in the append-only history', async () => {
	const fixture = storageFixture()
	const origin = fixture.games[0]
	const target = fixture.games[1]
	if (origin === undefined || target === undefined) throw new Error('Missing fixture games')
	const second = slot(source, 1)
	origin.local = [fixture.leaf, second]
	origin.consumed = [fixture.leaf.leaf.parentDepositIndex]
	target.inherited = [fixture.leaf, second]
	const candidates = await load(fixture)
	expect(candidates.map(candidate => candidate.parentDepositIndex)).toEqual([fixture.leaf.leaf.parentDepositIndex, second.leaf.parentDepositIndex])
	expect(candidates[1]?.proof?.leafIndex).toBe('1')
	expect(candidates[1]?.proof?.merkleMountainRangeSiblings).toEqual([fixture.leaf.hash])
})

for (const [name, corrupt, error] of [
	['snapshot root', (fixture: ReturnType<typeof storageFixture>) => fixture.setBadSnapshot(), 'snapshot root'],
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
	// Three slot(source, index) leaves, index 0 consumed.
	// Keep these fixed so the isolated bot package does not require a UI build.
	expect(
		candidates.map(candidate => {
			if (candidate.proof === undefined) throw new Error('Missing selected proof')
			return {
				parentDepositIndex: candidate.parentDepositIndex,
				leafIndex: candidate.proof.leafIndex,
				merkleMountainRangePeakIndex: candidate.proof.merkleMountainRangePeakIndex,
				merkleMountainRangeSiblings: candidate.proof.merkleMountainRangeSiblings,
			}
		}),
	).toEqual([
		{
			parentDepositIndex: '7922816251426433759354395033601',
			leafIndex: '1',
			merkleMountainRangePeakIndex: '1',
			merkleMountainRangeSiblings: ['0xa0ebcd7d728cddad423416b7e319cf69a5e7af4d5702891f3f7b55282b9bb242', '0xe1eea733fcdf27da77be796af99d98288d5a9966e69b65bfb26705f0d1b677b8'],
		},
		{
			parentDepositIndex: '7922816251426433759354395033602',
			leafIndex: '2',
			merkleMountainRangePeakIndex: '0',
			merkleMountainRangeSiblings: ['0xc408daae22afc1ac502346d55051a1afca1778a34b4b4df97771c07e856b453d'],
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

test('deep canonical claims settle without ancestry preparation', async () => {
	const fixture = storageFixture()
	fixture.leaf.leaf.parentDepositIndex = '0'
	fixture.leaf.hash = hashCarryLeaf(fixture.leaf.leaf)
	let parent = child
	for (let depth = 0; depth < 24; depth++) {
		const game = address(400 + depth * 2)
		fixture.games.push({ game, parent, inherited: [fixture.leaf], local: [], consumed: [] })
		parent = game
	}
	const result = await scanCarryStorage({ client: fixture.client, escalationGames: [{ pool: fixture.pool(parent), escalationGame: parent }], wallet, anchorBlockNumber: anchor, expectedAnchorHash: blockHash, questionForker: forker, maximumItems: 1000 })
	expect(result.withdrawals).toHaveLength(1)
	expect(result.withdrawals[0]?.claimSourceGame).toBe(source)
	expect(fixture.calls.some(call => call.functionName?.includes('ClaimCheckpoint'))).toBeFalse()
})

test('derives the payout from the threshold frozen at the first winning claim', async () => {
	const fixture = storageFixture()
	// Frozen at the live value, the derived payout still equals the simulated one.
	fixture.setFrozenForkThreshold(10n)
	expect((await scan(fixture)).withdrawals).toHaveLength((await scan(storageFixture())).withdrawals.length)
	// A frozen threshold below the non-decision threshold scales the derived payout, which the unscaled simulation no longer matches.
	fixture.setFrozenForkThreshold(5n)
	await expect(scan(fixture)).rejects.toThrow('economics')
})

test('#1539 canonical carry retains game-local replay filtering', async () => {
	const fixture = storageFixture()
	expect((await scan(fixture)).withdrawals).toHaveLength(1)
	const target = fixture.games.find(game => game.game === child)
	if (target === undefined) throw new Error('Missing child fixture')
	target.consumed.push(fixture.leaf.leaf.parentDepositIndex)
	expect(await load(fixture)).toEqual([])
})
