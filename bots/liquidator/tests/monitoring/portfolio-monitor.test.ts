import { expect, test } from 'bun:test'
import { managedPortfolioScopes, portfolioPositionPage, requireCompletePortfolioExposure } from '../../src/monitoring/portfolio-monitor.ts'
import { parsePortfolioScopes } from '../../src/state/portfolio-scopes.ts'
import { portfolioAddress } from '../support/portfolio-observation.ts'

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
	expect(parsePortfolioScopes(serialized)).toEqual([scope])
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
	fixture.values['getSecurityPool'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('canonical origin')
	fixture.values['getSecurityPool'] = fixture.values['seedPool']
	fixture.values['getRepToken'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('identity')
})

test('never exposes the protected aggregate auction cohort as an ordinary keeper target', async () => {
	const fixture = portfolioClient({ auctionCohort: [portfolioAddress, 1n, 0n, 1n, 1n] })
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(0)
})

test('monitors underfunded reserve and marks unchanged blocked retirement only after repeated observations', async () => {
	const fixture = portfolioClient({ accountOf: { owner: portfolioAddress, batch: 1n, rep: 1n, commitment: 10n ** 18n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, previewRetirement: { status: 3n } })
	const scope = { ...fixture.observation.nextScope, retirementObservations: [{ id: 1n, batch: 1n, commitment: 10n ** 18n, since: 1n }] }
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n)
	expect(result.positions[0]).toMatchObject({ retirementStatus: 'Earlier requests reserve available capacity', stalledRetirement: true })
	expect(result.positions[0]?.executionReserveAttoEth).toBeLessThan(result.positions[0]?.requiredExecutionReserveAttoEth ?? 0n)
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

test('accepts a genuine portfolio whose constructor seed remains a standalone pool', async () => {
	const fixture = portfolioClient({ getSecurityPoolPortfolio: '0x0000000000000000000000000000000000000000' })
	const observation = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(observation.snapshot.portfolio).toBe(portfolioAddress)
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

test('auction cursors persist bounded sweeps and reset safely when a reorg reduces the registry', () => {
	const scope = { ...selection, nextPositionId: 1n, sweepEnd: 0n, nextAuctionBidId: 1n, auctionSweepEnd: 0n }
	const page = portfolioAuctionPage(scope, 200n, 2)
	expect(page.ids).toEqual([1n, 2n])
	const second = portfolioAuctionPage({ ...scope, ...page }, 900n, 2)
	expect(second.ids).toEqual([3n, 4n])
	expect(second.auctionSweepEnd).toBe(200n)
	expect(portfolioAuctionPage({ ...scope, ...second }, 1n, 2).ids).toEqual([1n])
	const saved = { ...scope, nextAuctionBidId: 8n, auctionSweepEnd: 200n, retirementObservations: [] }
	const serialized: unknown = JSON.parse(JSON.stringify([saved], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
	expect(parsePortfolioScopes(serialized)).toEqual([saved])
	expect(() => parsePortfolioScopes([{ ...selection, universeId: '0', nextPositionId: '1', sweepEnd: '0', nextAuctionBidId: '0', auctionSweepEnd: '1' }])).toThrow('auction cursor')
})

function auctionFixture() {
	const fixture = portfolioClient()
	const auction = fixture.module('SecurityPoolPortfolioAuction')
	const engine = fixture.module('SecurityPoolUniformPriceAuction')
	const vault = fixture.module('SecurityPoolAuctionVault')
	Object.assign(fixture.values, {
		auctionCohort: [auction, 1n, 2n, 9n, 10n],
		capital: fixture.observation.snapshot.capitalLedger,
		engine,
		finalized: true,
		auctions: auction,
		controller: auction,
		bidCount: 2n,
		maximumHealthyPrice: 7n,
		auctionPosition: { vault, positionId: 0n, materialized: false, principal: 18n, commitment: 20n, targetHealthFactorBps: 12_000n, liquidationStarted: 100n, earnedAttoEth: 0n, earnedAttoRep: 0n },
		previewBid: { bidder: targetAddress, vault, targetHealthBps: 12_000n, filledLots: 2n, usedAttoEth: 20n, filledAttoRep: 8n, refundAttoEth: 0n },
		owner: targetAddress,
		initialCapital: fixture.observation.snapshot.capitalLedger,
		auction,
		bidId: 1n,
		bidIdForVault: 1n,
		bidExecutionReserve: 555n,
	})
	fixture.settings.portfolioPolicy.maximumPositionsPerScan = 1
	return { ...fixture, auction, engine, vault }
}

test('discovers a funded unmaterialized bid with its own reserve and never invents a live index position', async () => {
	const fixture = auctionFixture()
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(1)
	expect(result.positions[0]).toMatchObject({ id: 1n, auctionTarget: { auction: fixture.auction, bidId: 1n, vault: fixture.vault }, owner: fixture.vault, rep: 18n, commitment: 20n, executionReserveAttoEth: 555n, maxHealthyPrice: 7n, liquidationStarted: 100n })
	expect(result.nextScope.nextAuctionBidId).toBe(2n)
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
	fixture.values['accountOf'] = { owner: fixture.vault, batch: 0n, rep: 99n, commitment: 100n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions[0]).toMatchObject({ owner: fixture.vault, controllingOwner: fixture.observation.snapshot.owner })
})
