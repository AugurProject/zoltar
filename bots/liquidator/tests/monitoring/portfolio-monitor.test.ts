import { expect, test } from 'bun:test'
import { managedPortfolioScopes, portfolioPositionPage, requireCompletePortfolioExposure } from '../../src/monitoring/portfolio-monitor.ts'
import { parsePortfolioScopes } from '../../src/state/portfolio-scopes.ts'
import { portfolioAddress } from '../support/portfolio-observation.ts'
import { auctionVaultRuntimeCode } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { getAddress } from '@zoltar/bot-shared/ethereum'

const selection = { address: portfolioAddress, universeId: 0n }
test('bounded historical sweeps cannot be postponed by new registrations and revisit rekeyed old positions', () => {
	const scope = { ...selection, nextPositionId: 1n, sweepEnd: 0n }
	const first = portfolioPositionPage(scope, 5n, 2)
	expect(first.ids).toEqual([1n, 2n])
	const second = portfolioPositionPage(first.nextScope, 100n, 2)
	expect(second.ids).toEqual([3n, 4n])
	const third = portfolioPositionPage(second.nextScope, 200n, 2)
	expect(third.ids).toEqual([5n])
	expect(portfolioPositionPage(third.nextScope, 200n, 2).ids).toEqual([1n, 2n])
})

test('deselected scopes remain in exposure accounting and persisted cursors survive restart', () => {
	const scopes = managedPortfolioScopes([], [selection])
	expect(managedPortfolioScopes(scopes, [])).toEqual(scopes)
	const scope = { ...selection, nextPositionId: 33n, sweepEnd: 150n, retirementObservations: [{ id: 3n, batch: 1n, commitment: 100n, since: 1000n }] }
	const serialized: unknown = JSON.parse(JSON.stringify([scope], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
	expect(parsePortfolioScopes(serialized)).toEqual([{ ...scope, managedVaults: [] }])
	expect(() => parsePortfolioScopes([{ ...selection, universeId: '0', nextPositionId: '0', sweepEnd: '0' }])).toThrow('cursor')
})

import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { portfolioClient } from '../support/portfolio-client.ts'

test('authenticates factory, ledger, index and REP identity and pins every read including wallet funding', async () => {
	const fixture = portfolioClient()
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(1)
	expect(result.snapshot.blockNumber).toBe(123n)
	expect(fixture.reads.length).toBeGreaterThan(30)
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
	const ledgerAuthorityReads = fixture.reads.filter(read => read.functionName === 'capitalLedger').map(read => read.address)
	expect(ledgerAuthorityReads).toContain(fixture.observation.snapshot.commitmentIndex)
	expect(ledgerAuthorityReads).toContain(fixture.module('SecurityPoolCapitalFeeStreams'))
	fixture.values['factory'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('another factory')
	fixture.values['factory'] = fixture.settings.deployment.securityPoolFactory
	fixture.values['getRepToken'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('identity')
})

test('never exposes the protected aggregate auction cohort as an ordinary keeper target', async () => {
	const fixture = portfolioClient({ auctionCohort: [portfolioAddress, 1n, 0n, 1n, 1n] })
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(0)
})

test('marks unchanged blocked retirement only after repeated observations', async () => {
	const fixture = portfolioClient({ accountOf: { owner: portfolioAddress, batch: 1n, rep: 1n, commitment: 10n ** 18n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, previewRetirement: { status: 3n } })
	const scope = { ...fixture.observation.nextScope, retirementObservations: [{ id: 1n, batch: 1n, commitment: 10n ** 18n, since: 1n }] }
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n)
	expect(result.positions[0]).toMatchObject({ retirementStatus: 'Earlier requests reserve available capacity', stalledRetirement: true })
	const reset = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, { ...scope, retirementObservations: [] }, 123n)
	expect(reset.positions[0]?.stalledRetirement).toBe(false)
})

test('rejects a caller-owned factory namespace with counterfeit portfolio runtime', async () => {
	const fixture = portfolioClient()
	const client = new Proxy(fixture.client, {
		get(target, property) {
			if (property === 'getCode') return async () => '0x6000'
			return Reflect.get(target, property, target)
		},
	})
	await expect(loadPortfolioObservation(client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('runtime')
})

test('genuine runtime does not authenticate a hostile fork or protocol authority', async () => {
	const fixture = portfolioClient()
	fixture.values['forkAuthority'] = portfolioAddress
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('fork authority')
	fixture.values['forkAuthority'] = fixture.module('SecurityPoolPortfolioForkCoordinator')
	const client = new Proxy(fixture.client, {
		get(target, property) {
			if (property === 'readContract')
				return async (parameters: Parameters<typeof target.readContract>[0]) => {
					if (parameters.functionName === 'zoltar' && parameters.address === fixture.observation.snapshot.capitalLedger) return portfolioAddress
					return target.readContract(parameters)
				}
			return Reflect.get(target, property, target)
		},
	})
	await expect(loadPortfolioObservation(client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('another protocol')
})

test('authenticates a portfolio directly without a seed question mapping', async () => {
	const fixture = portfolioClient({ getSecurityPoolPortfolio: '0x0000000000000000000000000000000000000000' })
	const observation = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(observation.snapshot.portfolio).toBe(portfolioAddress)
	expect(fixture.reads.some(read => read.functionName === 'getSecurityPoolPortfolio')).toBe(false)
})

test('exported managed principal cannot disappear without its authenticated chosen child scope', async () => {
	const fixture = portfolioClient({ exported: true, choices: [2n, true], getChildUniverseId: 7n })
	const parent = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(parent.chosenChildUniverseId).toBe(7n)
	expect(() => requireCompletePortfolioExposure([parent])).toThrow('chosen fork universe 7')
	const child = { ...fixture.observation, selection: { ...fixture.observation.selection, universeId: 7n } }
	expect(() => requireCompletePortfolioExposure([parent, child])).not.toThrow()
	expect(managedPortfolioScopes([parent.nextScope], [])).toEqual([parent.nextScope])
})

import { portfolioAuctionPage } from '../../src/monitoring/portfolio-auction.ts'
import { targetAddress } from '../support/portfolio-observation.ts'

test('winner cursors skip history, survive removal, wrap and reset after a shorter reorg', async () => {
	const fixture = auctionFixture()
	const next = (after: bigint, maximum = 2, count = 5000n) => portfolioAuctionPage(fixture.client, fixture.engine, 123n, after, count, maximum)
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
	expect(parsePortfolioScopes(serialized)).toEqual([{ ...saved, managedVaults: [] }])
	expect(() => parsePortfolioScopes([{ ...selection, universeId: '0', nextPositionId: '1', sweepEnd: '0', auctionAfterBidId: '-1' }])).toThrow('auction cursor')
	fixture.values['nextUnmaterializedBid'] = 4000n
	await expect(next(0n)).rejects.toThrow('Invalid auction winner cursor')
	await expect(next(0n, 257)).rejects.toThrow('Invalid auction page size')
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
})

function auctionFixture() {
	const fixture = portfolioClient()
	const auction = fixture.module('SecurityPoolPortfolioAuction')
	const engine = fixture.module('SecurityPoolUniformPriceAuction')
	const implementation = fixture.module('SecurityPoolAuctionVault')
	const vault = getAddress('0x0000000000000000000000000000000000000199')
	const cloneCode = (bindings: Partial<Parameters<typeof auctionVaultRuntimeCode>[0]> = {}) => auctionVaultRuntimeCode({ implementation, owner: targetAddress, capital: fixture.observation.snapshot.capitalLedger, auction, bidId: 1n, ...bindings })
	fixture.codes.set(vault, cloneCode())
	Object.assign(fixture.values, {
		vaultImplementation: implementation,
		auctionCohort: [auction, 1n, 2n, 9n, 10n],
		capital: fixture.observation.snapshot.capitalLedger,
		engine,
		finalized: true,
		auctions: auction,
		controller: auction,
		bidCount: 2n,
		nextUnmaterializedBid: 1n,
		maximumHealthyPrice: 7n,
		auctionPosition: { vault, positionId: 0n, materialized: false, principal: 18n, commitment: 20n, targetHealthFactorBps: 12_000n, liquidationStarted: 100n, earnedAttoEth: 0n, earnedAttoRep: 0n },
		previewBid: { bidder: targetAddress, vault, targetHealthBps: 12_000n, filledLots: 2n, usedAttoEth: 20n, principalAttoRep: 8n, refundAttoEth: 0n },
		owner: targetAddress,
		initialCapital: fixture.observation.snapshot.capitalLedger,
		auction,
		bidId: 1n,
		bidIdForVault: 1n,
	})
	fixture.settings.portfolioPolicy.maximumPositionsPerScan = 1
	return { ...fixture, auction, engine, implementation, vault, cloneCode }
}

test('discovers a funded unmaterialized bid and never invents a live index position', async () => {
	const fixture = auctionFixture()
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(1)
	expect(result.positions[0]).toMatchObject({ id: 1n, auctionTarget: { auction: fixture.auction, bidId: 1n, vault: fixture.vault }, owner: fixture.vault, rep: 18n, commitment: 20n, maxHealthyPrice: 7n, liquidationStarted: 100n })
	expect(result.nextScope.auctionAfterBidId).toBe(1n)
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
	fixture.values['auctionPosition'] = { materialized: true }
	const materialized = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(materialized.positions).toHaveLength(0)
})

test('rejects counterfeit auction links, runtime and bid vault before exposing a target', async () => {
	for (const mutation of [
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['controller'] = portfolioAddress
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['initialCapital'] = portfolioAddress
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.values['bidIdForVault'] = 2n
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.vault, '0x6000')
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.vault, fixture.cloneCode({ implementation: fixture.engine }))
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.vault, fixture.cloneCode({ bidId: 2n }))
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.implementation, '0x6000')
		},
		(fixture: ReturnType<typeof auctionFixture>) => {
			fixture.codes.set(fixture.engine, '0x6000')
		},
	]) {
		const fixture = auctionFixture()
		mutation(fixture)
		await expect(loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow()
	}
})

test('preserves a materialized auction vault controlling owner for keeper self-dealing exclusions', async () => {
	const fixture = auctionFixture()
	fixture.values['auctionCohort'] = ['0x0000000000000000000000000000000000000000', 0n, 0n, 0n, 0n]
	fixture.values['owner'] = fixture.observation.snapshot.owner
	fixture.codes.set(fixture.vault, fixture.cloneCode({ owner: fixture.observation.snapshot.owner }))
	fixture.values['accountOf'] = { owner: fixture.vault, batch: 0n, rep: 99n, commitment: 100n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions[0]).toMatchObject({ owner: fixture.vault, controllingOwner: fixture.observation.snapshot.owner })
	// A canonical clone whose getter disagrees with its code can only come from an inconsistent node.
	fixture.values['owner'] = targetAddress
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('does not match its code')
	fixture.values['owner'] = fixture.observation.snapshot.owner
	// Anyone can open a position from a clone-shaped contract with another implementation: it is an ordinary owner and never stalls the scan.
	fixture.codes.set(fixture.implementation, '0x6000')
	const ownerReads = fixture.reads.filter(read => read.functionName === 'owner').length
	const foreign = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(foreign.positions[0]).toMatchObject({ owner: fixture.vault, controllingOwner: fixture.vault })
	expect(fixture.reads.filter(read => read.functionName === 'owner')).toHaveLength(ownerReads)
})

test('auction discovery jumps directly to a winner beyond losing history', async () => {
	const fixture = auctionFixture()
	Object.assign(fixture.values, { bidCount: 5000n, nextUnmaterializedBid: 4000n, bidId: 4000n, bidIdForVault: 4000n })
	fixture.codes.set(fixture.vault, fixture.cloneCode({ bidId: 4000n }))
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions[0]?.id).toBe(4000n)
	expect(fixture.reads.filter(read => read.functionName === 'auctionPosition')).toHaveLength(1)
})

test('targeted revalidation preserves discovery cursor without fetching another page', async () => {
	const fixture = auctionFixture()
	const scope = { ...fixture.observation.nextScope, auctionAfterBidId: 2n }
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n, [{ auction: fixture.auction, bidId: 1n, vault: fixture.vault }])
	expect(result.nextScope.auctionAfterBidId).toBe(2n)
	expect(fixture.reads.filter(read => read.functionName === 'nextUnmaterializedBid')).toHaveLength(0)
})

test('refuses automatic gas-profit estimates for non-WETH collateral', async () => {
	const fixture = portfolioClient()
	fixture.values['collateralToken'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('require WETH collateral')
})
