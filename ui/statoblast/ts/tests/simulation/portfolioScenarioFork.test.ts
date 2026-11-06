import { createSimulationEngine } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { setRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { getZoltarAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'
import { forkSeededPortfolio } from '@zoltar/ui-statoblast-shared/simulation/portfolioScenarioFork.js'
import { createCompleteSetInSecurityPool, loadTradingDetails, migrateSharesFromUniverse, redeemCompleteSetInSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { discoverSimulationPortfolio, portfolioReadClient } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { loadPortfolioForkSnapshot, quotePortfolioAuctionRefundClaim } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { loadPortfolioBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioAuction.js'
import { expect, test } from 'bun:test'
import { createPublicClient, custom } from '@zoltar/core-shared/evm/ethereum'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { simulationSetupTimeoutMs } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadAllSecurityPools } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'

test(
	'forked portfolio simulation retains parent shares and prepares a child question',
	async () => {
		const engine = await createSimulationEngine({
			dependencies: {
				applyScenario: async parameters => {
					setRuntimeNetworkProfile(parameters.profile)
					await applyStatoblastScenario({ ...parameters, scenario: 'security-pool' })
					const [pool] = await loadAllSecurityPools(parameters.createReadClient())
					if (pool === undefined) throw new Error('Missing seeded portfolio question')
					const owner = parameters.accounts[0]
					if (owner === undefined) throw new Error('Missing portfolio owner')
					const writer = parameters.createWriteClient(owner)
					const before = await loadTradingDetails(parameters.createReadClient(), pool.securityPoolAddress, owner)
					await createCompleteSetInSecurityPool(writer, pool.securityPoolAddress, 10n ** 16n)
					const minted = await loadTradingDetails(parameters.createReadClient(), pool.securityPoolAddress, owner)
					expect(minted.shareBalances?.yesAttoShares).toBeGreaterThan(before.shareBalances?.yesAttoShares ?? 0n)
					await redeemCompleteSetInSecurityPool(writer, pool.securityPoolAddress, 10n ** 15n)
					const redeemed = await loadTradingDetails(parameters.createReadClient(), pool.securityPoolAddress, owner)
					expect(redeemed.shareBalances?.yesAttoShares).toBe((minted.shareBalances?.yesAttoShares ?? 0n) - 10n ** 15n)
					await forkSeededPortfolio(parameters, pool.portfolioAddress, pool.securityPoolAddress, BigInt(pool.questionId))
					await migrateSharesFromUniverse(writer, pool.securityPoolAddress, 'no', [1n], redeemed.shareBalances?.noAttoShares)
					const remaining = await loadTradingDetails(parameters.createReadClient(), pool.securityPoolAddress, owner)
					expect(remaining.shareBalances?.noAttoShares).toBe(redeemed.shareBalances?.noAttoShares)
					const child = (await loadAllSecurityPools(parameters.createReadClient())).find(candidate => candidate.universeId !== 0n)
					if (child === undefined) throw new Error('Missing migrated child question')
					const childDetails = await loadTradingDetails(parameters.createReadClient(), child.securityPoolAddress, owner)
					expect(childDetails.shareBalances?.noAttoShares).toBe(redeemed.shareBalances?.noAttoShares)
					await expect(migrateSharesFromUniverse(writer, pool.securityPoolAddress, 'no', [1n])).rejects.toThrow()
					return true
				},
				getDeploymentSteps,
				getZoltarAddress,
			},
			initialization: { kind: 'scenario', scenario: 'portfolio' },
		})
		try {
			await engine.bootstrap()
			setRuntimeNetworkProfile(engine.getProfile())
			const client = createPublicClient({ transport: custom({ request: request => engine.request(request) }) })
			const pools = await loadAllSecurityPools(client)
			expect(pools.some(pool => pool.universeId === 0n && pool.universeHasForked)).toBe(true)
			expect(pools.some(pool => pool.universeId !== 0n)).toBe(true)
			const parent = pools.find(pool => pool.universeId === 0n)
			const [owner] = await engine.getAccounts()
			if (parent === undefined || owner === undefined) throw new Error('Missing parent market or wallet')
			const details = await loadTradingDetails(client, parent.securityPoolAddress, owner)
			expect(details.shareBalances?.yesAttoShares).toBeGreaterThan(0n)
		} finally {
			resetActiveEnvironmentForTesting()
		}
	},
	simulationSetupTimeoutMs,
)

test(
	'native auction seeding produces binding demand and a provably excluded refundable bid',
	async () => {
		const engine = await createSimulationEngine({
			dependencies: {
				applyScenario: async parameters => {
					setRuntimeNetworkProfile(parameters.profile)
					return await applyStatoblastScenario(parameters)
				},
				getDeploymentSteps,
				getZoltarAddress,
			},
			initialization: { kind: 'scenario', scenario: 'portfolio-auction' },
		})
		try {
			await engine.bootstrap()
			const client = createPublicClient({ transport: custom({ request: request => engine.request(request) }) })
			const [owner] = await engine.getAccounts()
			if (owner === undefined) throw new Error('Missing auction owner')
			const portfolio = await discoverSimulationPortfolio(client, 'simulation', owner)
			if (portfolio === undefined) throw new Error('Missing auction portfolio')
			const fork = await loadPortfolioForkSnapshot({ client: portfolioReadClient(client), portfolio, owner, universeId: 0n, outcomeIndex: 1n })
			if (fork.branch === undefined) throw new Error('Missing auction branch')
			const snapshot = await loadPortfolioBranchAuction(client, portfolio, owner, fork.branch.universeId)
			const auction = snapshot.auction
			if (auction === undefined) throw new Error('Missing seeded auction')
			expect(auction).toMatchObject({ opened: true, finalized: false })
			const excluded = auction.bids.find(bid => bid.earlyRefundAttoEth > 0n)
			const binding = auction.bids.find(bid => bid.earlyRefundAttoEth === 0n)
			if (excluded === undefined || binding === undefined) throw new Error('Missing excluded or binding demand')
			expect(quotePortfolioAuctionRefundClaim(snapshot, excluded.id).bidRefundAttoEth).toBe(excluded.lots * auction.lotAttoEth)
			expect(() => quotePortfolioAuctionRefundClaim(snapshot, binding.id)).toThrow('may still win')
		} finally {
			resetActiveEnvironmentForTesting()
		}
	},
	simulationSetupTimeoutMs,
)
