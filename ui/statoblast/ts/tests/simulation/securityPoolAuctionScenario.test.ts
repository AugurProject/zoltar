/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { quoteSecurityPoolAuctionRefundClaim } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { loadSecurityPoolBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolRepairAuction.js'
import { loadSecurityPoolForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { securityPoolReadClient } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'

// The seeding forks, starts a branch and opens its auction; this bootstraps under its own setup limit.
void describe('security pool branch auction simulation scenario', () => {
	let backend: SimulationBackend

	beforeAll(async () => {
		backend = await createBootstrappedSimulationBackendWithRetry('portfolio-auction', 1, 'statoblast')
	}, simulationSetupTimeoutMs)

	afterAll(async () => {
		if (backend !== undefined) await backend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	void test('portfolio-auction opens the Yes branch auction with binding and excluded owner bids and a rival bid', async () => {
		activateSimulationBackendProfile(backend)
		const owner = backend.accounts[0]
		if (owner === undefined) throw new Error('Expected the simulation owner account')
		const readClient = backend.createReadClient()
		const securityPool = backend.seededSecurityPool?.address
		if (securityPool === undefined) throw new Error('Expected the seeded security pool')
		const fork = await loadSecurityPoolForkSnapshot({ client: securityPoolReadClient(readClient), securityPool, owner, universeId: 0n, outcomeIndex: 1n })
		expect(fork.forkTime).toBeGreaterThan(0n)
		const child = fork.branch?.universeId
		if (child === undefined) throw new Error('Expected the started Yes branch')
		const snapshot = await loadSecurityPoolBranchAuction(readClient, securityPool, owner, child)
		const auction = snapshot.auction
		if (auction === undefined) throw new Error('Expected the branch auction')
		expect(auction).toMatchObject({ opened: true, finalized: false })
		expect(auction.bids).toHaveLength(2)
		const rival = backend.accounts[1]
		if (rival === undefined) throw new Error('Expected the simulation rival bidder')
		const rivalSnapshot = await loadSecurityPoolBranchAuction(readClient, securityPool, rival, child)
		expect(rivalSnapshot.auction?.bids).toHaveLength(1)
		expect(rivalSnapshot.auction?.bids[0]?.lots).toBe(auction.targetLots)

		const excluded = auction.bids.find(bid => bid.earlyRefundAttoEth > 0n)
		const winning = auction.bids.find(bid => bid.earlyRefundAttoEth === 0n)
		if (excluded === undefined || winning === undefined) throw new Error('Expected one excluded and one still-binding owner bid')
		expect(quoteSecurityPoolAuctionRefundClaim(snapshot, excluded.id)).toMatchObject({ settles: true, bidRefundAttoEth: excluded.lots * auction.lotAttoEth, creditedAttoEth: 0n })
		expect(() => quoteSecurityPoolAuctionRefundClaim(snapshot, winning.id)).toThrow('may still win')
	}, 60_000)
})
