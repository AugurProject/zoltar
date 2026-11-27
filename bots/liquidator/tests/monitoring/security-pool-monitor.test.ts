import { scanExecutionSnapshot } from '../../src/runtime/scan-cycle.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { expect, test } from 'bun:test'
import { managedSecurityPoolScopes, securityPoolPositionPage, requireCompleteSecurityPoolExposure } from '../../src/monitoring/security-pool-monitor.ts'
import { parseSecurityPoolScopes } from '../../src/state/security-pool-scopes.ts'
import { securityPoolAddress } from '../support/security-pool-observation.ts'
import { getAddress } from '@zoltar/bot-shared/ethereum'

const selection = { address: securityPoolAddress, universeId: 0n }
test('bounded historical sweeps cannot be postponed by new registrations and revisit rekeyed old positions', () => {
	const scope = { ...selection, nextPositionId: 1n, sweepEnd: 0n }
	const first = securityPoolPositionPage(scope, 5n, 2)
	expect(first.ids).toEqual([1n, 2n])
	const second = securityPoolPositionPage(first.nextScope, 100n, 2)
	expect(second.ids).toEqual([3n, 4n])
	const third = securityPoolPositionPage(second.nextScope, 200n, 2)
	expect(third.ids).toEqual([5n])
	expect(securityPoolPositionPage(third.nextScope, 200n, 2).ids).toEqual([1n, 2n])
})

test('deselected scopes remain in exposure accounting and persisted cursors survive restart', () => {
	const scopes = managedSecurityPoolScopes([], [selection])
	expect(managedSecurityPoolScopes(scopes, [])).toEqual(scopes)
	const scope = { ...selection, nextPositionId: 33n, sweepEnd: 150n, retirementObservations: [{ id: 3n, batch: 1n, commitment: 100n, since: 1000n }] }
	const serialized: unknown = JSON.parse(JSON.stringify([scope], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
	expect(parseSecurityPoolScopes(serialized)).toEqual([scope])
	expect(() => parseSecurityPoolScopes([{ ...selection, universeId: '0', nextPositionId: '0', sweepEnd: '0' }])).toThrow('cursor')
})

import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { securityPoolClient } from '../support/security-pool-client.ts'

test('authenticates factory, ledger, index and REP identity and pins every read including wallet funding', async () => {
	const fixture = securityPoolClient()
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(1)
	expect(result.snapshot.blockNumber).toBe(123n)
	expect(fixture.reads.length).toBeGreaterThan(30)
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
	const ledgerAuthorityReads = fixture.reads.filter(read => read.functionName === 'capitalLedger').map(read => read.address)
	expect(ledgerAuthorityReads).toContain(fixture.observation.snapshot.commitmentIndex)
	expect(ledgerAuthorityReads).toContain(fixture.module('SecurityPoolCapitalFeeStreams'))
	fixture.values['factory'] = fixture.settings.deployment.zoltar
	await expect(loadSecurityPoolObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('another factory')
	fixture.values['factory'] = fixture.settings.deployment.securityPoolFactory
	fixture.values['getRepToken'] = fixture.settings.deployment.zoltar
	await expect(loadSecurityPoolObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('identity')
})

test('never exposes the protected aggregate auction cohort as an ordinary keeper target', async () => {
	const fixture = securityPoolClient({ repairAuctionCohort: [securityPoolAddress, 1n, 0n, 1n, 1n] })
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(0)
})

test('marks unchanged blocked retirement only after repeated observations', async () => {
	const fixture = securityPoolClient({ accountOf: { owner: securityPoolAddress, batch: 1n, rep: 1n, commitment: 10n ** 18n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, previewRetirement: { status: 3n } })
	const scope = { ...fixture.observation.nextScope, retirementObservations: [{ id: 1n, batch: 1n, commitment: 10n ** 18n, since: 1n }] }
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n)
	expect(result.positions[0]).toMatchObject({ retirementStatus: 'Capacity reserved for earlier requests', stalledRetirement: true })
	const reset = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, { ...scope, retirementObservations: [] }, 123n)
	expect(reset.positions[0]?.stalledRetirement).toBe(false)
})

test('rejects a caller-owned factory namespace with counterfeit security pool runtime', async () => {
	const fixture = securityPoolClient()
	const client = new Proxy(fixture.client, {
		get(target, property) {
			if (property === 'getCode') return async () => '0x6000'
			return Reflect.get(target, property, target)
		},
	})
	await expect(loadSecurityPoolObservation(client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('runtime')
})

test('genuine runtime does not authenticate a hostile fork or protocol authority', async () => {
	const fixture = securityPoolClient()
	fixture.values['forkAuthority'] = securityPoolAddress
	await expect(loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('fork authority')
	fixture.values['forkAuthority'] = fixture.module('SecurityPoolForkCoordinator')
	const client = new Proxy(fixture.client, {
		get(target, property) {
			if (property === 'readContract')
				return async (parameters: Parameters<typeof target.readContract>[0]) => {
					if (parameters.functionName === 'zoltar' && parameters.address === fixture.observation.snapshot.capitalLedger) return securityPoolAddress
					return target.readContract(parameters)
				}
			return Reflect.get(target, property, target)
		},
	})
	await expect(loadSecurityPoolObservation(client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('another protocol')
})

test('authenticates a security pool directly without a seed question mapping', async () => {
	const fixture = securityPoolClient({ securityPoolOf: '0x0000000000000000000000000000000000000000' })
	const observation = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(observation.snapshot.securityPool).toBe(securityPoolAddress)
	expect(fixture.reads.some(read => read.functionName === 'securityPoolOf')).toBe(false)
})

test('exported managed principal cannot disappear without its authenticated chosen child scope', async () => {
	const fixture = securityPoolClient({ exported: true, choices: [2n, true], getChildUniverseId: 7n })
	const parent = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(parent.chosenChildUniverseId).toBe(7n)
	expect(() => requireCompleteSecurityPoolExposure([parent])).toThrow('chosen fork universe 7')
	const child = { ...fixture.observation, selection: { ...fixture.observation.selection, universeId: 7n } }
	expect(() => requireCompleteSecurityPoolExposure([parent, child])).not.toThrow()
	expect(managedSecurityPoolScopes([parent.nextScope], [])).toEqual([parent.nextScope])
})

import { securityPoolAuctionPage } from '../../src/monitoring/security-pool-auction.ts'
import { targetAddress } from '../support/security-pool-observation.ts'

test('winner cursors skip history, survive removal, wrap and reset after a shorter reorg', async () => {
	const fixture = auctionFixture()
	const next = (after: bigint, maximum = 2, count = 5000n) => securityPoolAuctionPage(fixture.client, fixture.engine, 123n, after, count, maximum)
	fixture.values['nextUnmaterializedBid'] = (args: readonly unknown[]) => {
		if (args[0] === 0n) return 4000n
		return args[0] === 4000n ? 2n : 0n
	}
	expect(await next(0n)).toEqual({ ids: [4000n, 2n], auctionAfterBidId: 2n })
	expect(await next(2n)).toEqual({ ids: [], auctionAfterBidId: 0n })
	// A detached cursor still locates its original position in the frozen tree.
	fixture.values['nextUnmaterializedBid'] = (args: readonly unknown[]) => (args[0] === 0n || args[0] === 4000n ? 2n : 0n)
	expect(await next(4000n)).toEqual({ ids: [2n], auctionAfterBidId: 0n })
	expect(await next(4000n, 2, 2n)).toEqual({ ids: [2n], auctionAfterBidId: 0n })
	// A same-sized reorg can reorder IDs; wrapping revisits winners before the cursor.
	fixture.values['nextUnmaterializedBid'] = (args: readonly unknown[]) => {
		if (args[0] === 0n) return 2n
		return args[0] === 2n ? 4000n : 0n
	}
	expect(await next(4000n)).toEqual({ ids: [], auctionAfterBidId: 0n })
	expect(await next(0n)).toEqual({ ids: [2n, 4000n], auctionAfterBidId: 4000n })
	const saved = { ...selection, nextPositionId: 1n, sweepEnd: 0n, auctionAfterBidId: 4000n, retirementObservations: [] }
	const serialized: unknown = JSON.parse(JSON.stringify([saved], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
	expect(parseSecurityPoolScopes(serialized)).toEqual([saved])
	expect(() => parseSecurityPoolScopes([{ ...selection, universeId: '0', nextPositionId: '1', sweepEnd: '0', auctionAfterBidId: '-1' }])).toThrow('auction cursor')
	fixture.values['nextUnmaterializedBid'] = 4000n
	await expect(next(0n)).rejects.toThrow('Invalid auction winner cursor')
	await expect(next(0n, 257)).rejects.toThrow('Invalid auction page size')
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
})

function auctionFixture() {
	const fixture = securityPoolClient()
	const auction = fixture.module('SecurityPoolRepairAuction')
	const engine = fixture.module('SecurityPoolUniformPriceRepairAuction')
	const bidder = targetAddress
	Object.assign(fixture.values, {
		repairAuctionCohort: [auction, 1n, 2n, 9n, 10n],
		capital: fixture.observation.snapshot.capitalLedger,
		engine,
		finalized: true,
		repairAuctions: auction,
		controller: auction,
		bidCount: 2n,
		nextUnmaterializedBid: 1n,
		repairAuctionPositions: [{ bidder, positionId: 0n, claimed: false, materialized: false, principal: 18n, commitment: 20n, liquidationStarted: 100n, earnedAttoEth: 0n, earnedAttoRep: 0n }],
		previewBid: { bidder, filledLots: 2n, usedAttoEth: 20n, principalAttoRep: 8n, refundAttoEth: 0n },
		// The bidder already holds position 5; the simulated claim reports the combined position.
		materializeRepairAuctionBids: [5n],
		'projected:accountOf': { owner: bidder, batch: 0n, rep: 117n, commitment: 120n, maxHealthyPrice: 7n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n },
	})
	fixture.settings.securityPoolPolicy.maximumPositionsPerScan = 1
	return { ...fixture, auction, engine, bidder }
}

test('targets a winning bid as its bidder position after the simulated claim of that bid', async () => {
	const fixture = auctionFixture()
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(1)
	expect(result.positions[0]).toMatchObject({ id: 1n, auctionTarget: { auction: fixture.auction, bidId: 1n, bidder: fixture.bidder }, owner: fixture.bidder, rep: 117n, commitment: 120n, maxHealthyPrice: 7n, liquidationStarted: 100n })
	expect(result.nextScope.auctionAfterBidId).toBe(1n)
	// Both simulations claim only the targeted bid.
	expect(fixture.reads.filter(read => read.functionName === 'materializeRepairAuctionBids').map(read => read.args)).toEqual([[[1n]], [[1n]]])
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
	fixture.values['repairAuctionPositions'] = [{ bidder: fixture.bidder, positionId: 0n, claimed: true, materialized: false, principal: 18n, commitment: 20n, liquidationStarted: 100n, earnedAttoEth: 0n, earnedAttoRep: 0n }]
	const claimed = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(claimed.positions).toHaveLength(0)
})

test('rejects counterfeit auction links, runtime and bidder identity before exposing a target', async () => {
	for (const mutation of [
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['controller'] = securityPoolAddress
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['previewBid'] = { bidder: securityPoolAddress, filledLots: 2n, usedAttoEth: 20n, principalAttoRep: 8n, refundAttoEth: 0n }
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['materializeRepairAuctionBids'] = [0n]
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['projected:accountOf'] = { owner: securityPoolAddress, batch: 0n, rep: 1n, commitment: 1n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.engine, '0x6000')
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.auction, '0x6000')
		},
	]) {
		const fixture = auctionFixture()
		mutation(fixture)
		await expect(loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow()
	}
})

test('lists each winning bid of one bidder as its own target because a takeover claims only that bid', async () => {
	const fixture = auctionFixture()
	fixture.settings.securityPoolPolicy.maximumPositionsPerScan = 4
	const winners = new Map<unknown, bigint>([
		[0n, 1n],
		[1n, 2n],
	])
	fixture.values['nextUnmaterializedBid'] = ([after]: readonly unknown[]) => winners.get(after) ?? 0n
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions.map(position => position.auctionTarget?.bidId)).toEqual([1n, 2n])
	expect(result.positions.map(position => position.owner)).toEqual([fixture.bidder, fixture.bidder])
	expect(result.nextScope.auctionAfterBidId).toBe(0n)
})

test('auction discovery jumps directly to a winner beyond losing history', async () => {
	const fixture = auctionFixture()
	Object.assign(fixture.values, { bidCount: 5000n, nextUnmaterializedBid: 4000n })
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions[0]?.id).toBe(4000n)
	expect(fixture.reads.filter(read => read.functionName === 'repairAuctionPositions')).toHaveLength(1)
})

test('targeted revalidation preserves discovery cursor without fetching another page', async () => {
	const fixture = auctionFixture()
	const scope = { ...fixture.observation.nextScope, auctionAfterBidId: 2n }
	const result = await loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n, [{ auction: fixture.auction, bidId: 1n, bidder: fixture.bidder }])
	expect(result.nextScope.auctionAfterBidId).toBe(2n)
	expect(fixture.reads.filter(read => read.functionName === 'nextUnmaterializedBid')).toHaveLength(0)
	await expect(loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n, [{ auction: fixture.auction, bidId: 1n, bidder: securityPoolAddress }])).rejects.toThrow('Auction target bidder changed')
})

test('refuses automatic gas-profit estimates for non-WETH collateral', async () => {
	const fixture = securityPoolClient()
	fixture.values['collateralToken'] = fixture.settings.deployment.zoltar
	await expect(loadSecurityPoolObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('require WETH collateral')
})

test('#1643 projects passive claimable earnings at the pinned execution block', async () => {
	const f = securityPoolClient()
	f.values['projected:ownerAccount'] = { ...f.observation.snapshot.ownerAccount, feesAttoEth: 10n ** 18n }
	const result = await loadSecurityPoolObservation(f.client, f.settings, f.observation.snapshot.owner, f.observation.nextScope, 123n)
	expect(result.snapshot.ownerAccount.feesAttoEth).toBe(0n)
	expect(result.snapshot.accruedFeesAttoEth).toBe(10n ** 18n)
	expect(f.reads.filter(read => read.functionName === 'checkpoint')).toHaveLength(1)
	expect(f.reads.every(read => read.blockNumber === 123n)).toBe(true)
})

test('#1638 failed prospective selections never enter durable managed history', async () => {
	const f = securityPoolClient()
	const state = initialRuntimeState(false, f.observation.snapshot.owner, 1)
	state.securityPoolScopes = [f.observation.nextScope]
	const original = structuredClone(state.securityPoolScopes)
	const unsupported = { address: getAddress('0x0000000000000000000000000000000000000099'), universeId: 0n }
	f.settings.selectedSecurityPools.push(unsupported)
	f.settings.runtime.execute = false
	const runtime = { settings: f.settings, client: f.client, readPool: createRpcEndpointPool(['https://read.example']) }
	await expect(scanExecutionSnapshot(runtime, { state, shutdown: { isRequested: () => false } }, chainFor(f.settings))).rejects.toThrow()
	expect(state.securityPoolScopes).toEqual(original)
	// The persisted restart set retains the healthy pool and cannot reintroduce the failed selection.
	const restarted = parseSecurityPoolScopes(JSON.parse(JSON.stringify(state.securityPoolScopes, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))))
	f.settings.selectedSecurityPools = [selection]
	expect(managedSecurityPoolScopes(restarted, f.settings.selectedSecurityPools).map(scope => scope.address)).toEqual([selection.address])
	await expect(loadSecurityPoolObservation(f.client, f.settings, state.wallet, restarted[0] ?? f.observation.nextScope, 123n)).resolves.toHaveProperty('snapshot')
})
