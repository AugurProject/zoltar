/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { quotePortfolioAuctionRefundClaim } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { discoverSimulationPortfolio } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { loadPortfolioBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioAuction.js'
import { loadPortfolioForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { portfolioReadClient } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'

// The seeding forks, starts a branch and opens its auction; this bootstraps under its own setup limit.
void describe('portfolio branch auction simulation scenario', () => {
	let backend: SimulationBackend

	beforeAll(async () => {
		backend = await createBootstrappedSimulationBackendWithRetry('portfolio-auction', 1, 'statoblast')
	}, simulationSetupTimeoutMs)

	afterAll(async () => {
		if (backend !== undefined) await backend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	void test('portfolio-auction opens the Yes branch auction with a winning, an excluded and a rival bid', async () => {
		activateSimulationBackendProfile(backend)
		const owner = backend.accounts[0]
		if (owner === undefined) throw new Error('Expected the simulation owner account')
		const readClient = backend.createReadClient()
		const portfolio = await discoverSimulationPortfolio(readClient, 'simulation', owner)
		if (portfolio === undefined) throw new Error('Expected the seeded portfolio')
		const fork = await loadPortfolioForkSnapshot({ client: portfolioReadClient(readClient), portfolio, owner, universeId: 0n, outcomeIndex: 1n })
		expect(fork.forkTime).toBeGreaterThan(0n)
		const child = fork.branch?.universeId
		if (child === undefined) throw new Error('Expected the started Yes branch')
		const snapshot = await loadPortfolioBranchAuction(readClient, portfolio, owner, child)
		const auction = snapshot.auction
		if (auction === undefined) throw new Error('Expected the branch auction')
		expect(auction).toMatchObject({ opened: true, finalized: false })
		expect(auction.bids).toHaveLength(2)
		const excluded = auction.bids.find(bid => bid.earlyRefundAttoEth > 0n)
		const winning = auction.bids.find(bid => bid.earlyRefundAttoEth === 0n)
		if (excluded === undefined || winning === undefined) throw new Error('Expected one excluded and one still-binding owner bid')
		expect(quotePortfolioAuctionRefundClaim(snapshot, excluded.id)).toMatchObject({ settles: true, bidRefundAttoEth: excluded.lots * auction.lotAttoEth, creditedAttoEth: 0n })
		expect(() => quotePortfolioAuctionRefundClaim(snapshot, winning.id)).toThrow('may still win')
	}, 60_000)
})
