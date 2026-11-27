import type { SeededSecurityPool } from '@zoltar/ui-core-shared/simulation/savedStates.js'
import { createSimulationEngine } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { setRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { getZoltarAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'
import { forkSeededSecurityPool } from '@zoltar/ui-statoblast-shared/simulation/securityPoolScenarioFork.js'
import { createCompleteSetInQuestionLedger, loadShareMigrationTargets, loadTradingDetails, migrateSharesFromUniverse, redeemCompleteSetInQuestionLedger } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { loadZoltarUniverseSummary } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import { securityPoolReadClient } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { loadSecurityPoolForkSnapshot, quoteSecurityPoolAuctionRefund } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { loadSecurityPoolBranchAuction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolRepairAuction.js'
import { expect, test } from 'bun:test'
import { createPublicClient, custom, type Address } from '@zoltar/core-shared/evm/ethereum'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { simulationSetupTimeoutMs } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadStatoblastQuestion } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'

test(
	'forked security pool simulation retains parent shares and prepares a child question',
	async () => {
		let childLedger: Address | undefined
		const engine = await createSimulationEngine({
			dependencies: {
				applyScenario: async parameters => {
					setRuntimeNetworkProfile(parameters.profile)
					let seed: SeededSecurityPool | undefined
					await applyStatoblastScenario({
						...parameters,
						scenario: 'security-pool',
						onSeededSecurityPool: value => {
							seed = value
							parameters.onSeededSecurityPool?.(value)
						},
					})
					if (seed === undefined) throw new Error('Missing seeded security pool')
					const questionId = seed.questionIds[0]
					if (questionId === undefined) throw new Error('Missing seeded question')
					const { question: pool } = await loadStatoblastQuestion(parameters.createReadClient(), seed.address, questionId, 0n, false)
					const owner = parameters.accounts[0]
					if (owner === undefined) throw new Error('Missing security pool owner')
					const writer = parameters.createWriteClient(owner)
					const before = await loadTradingDetails(parameters.createReadClient(), pool.questionLedgerAddress, owner)
					await createCompleteSetInQuestionLedger(writer, pool.questionLedgerAddress, 10n ** 16n)
					const minted = await loadTradingDetails(parameters.createReadClient(), pool.questionLedgerAddress, owner)
					expect(minted.shareBalances?.yesAttoShares).toBeGreaterThan(before.shareBalances?.yesAttoShares ?? 0n)
					await redeemCompleteSetInQuestionLedger(writer, pool.questionLedgerAddress, 10n ** 15n)
					const redeemed = await loadTradingDetails(parameters.createReadClient(), pool.questionLedgerAddress, owner)
					expect(redeemed.shareBalances?.yesAttoShares).toBe((minted.shareBalances?.yesAttoShares ?? 0n) - 10n ** 15n)
					await forkSeededSecurityPool(parameters, pool.securityPoolAddress, pool.questionLedgerAddress, BigInt(pool.questionId))
					const forkedUniverse = await loadZoltarUniverseSummary(parameters.createReadClient(), 0n)
					if (forkedUniverse === undefined) throw new Error('Missing forked universe')
					const targetsBefore = await loadShareMigrationTargets(parameters.createReadClient(), redeemed, forkedUniverse.childUniverses, owner)
					expect(targetsBefore.map(target => [target.outcomeIndex, target.canonicalPool !== undefined, target.migratedAttoShares.noAttoShares])).toEqual([
						[0n, false, 0n],
						[1n, true, 0n],
						[2n, false, 0n],
					])
					await expect(migrateSharesFromUniverse(writer, pool.questionLedgerAddress, 'no', [0n, 1n, 2n])).rejects.toThrow('ShareToken bulk migration requires canonical child pools')
					await migrateSharesFromUniverse(writer, pool.questionLedgerAddress, 'no', [1n], redeemed.shareBalances?.noAttoShares)
					const targetsAfter = await loadShareMigrationTargets(parameters.createReadClient(), redeemed, forkedUniverse.childUniverses, owner)
					expect(targetsAfter.find(target => target.outcomeIndex === 1n)?.migratedAttoShares.noAttoShares).toBe(redeemed.shareBalances?.noAttoShares)
					const remaining = await loadTradingDetails(parameters.createReadClient(), pool.questionLedgerAddress, owner)
					expect(remaining.shareBalances?.noAttoShares).toBe(redeemed.shareBalances?.noAttoShares)
					childLedger = targetsAfter.find(target => target.outcomeIndex === 1n)?.canonicalPool
					if (childLedger === undefined) throw new Error('Missing migrated child question')
					const childDetails = await loadTradingDetails(parameters.createReadClient(), childLedger, owner)
					expect(childDetails.shareBalances?.noAttoShares).toBe(redeemed.shareBalances?.noAttoShares)
					await expect(migrateSharesFromUniverse(writer, pool.questionLedgerAddress, 'no', [1n])).rejects.toThrow()
					return true
				},
				getDeploymentSteps,
				getZoltarAddress,
			},
			initialization: { kind: 'scenario', scenario: 'securitypoolx2' },
		})
		try {
			await engine.bootstrap()
			setRuntimeNetworkProfile(engine.getProfile())
			const client = createPublicClient({ transport: custom({ request: request => engine.request(request) }) })
			const seed = engine.getState().seededSecurityPool
			const questionId = seed?.questionIds[0]
			if (seed === undefined || questionId === undefined) throw new Error('Missing parent question')
			const { question: parent } = await loadStatoblastQuestion(client, seed.address, questionId, 0n, false)
			expect(parent.universeHasForked).toBe(true)
			expect(childLedger).toBeDefined()
			const [owner] = await engine.getAccounts()
			if (parent === undefined || owner === undefined) throw new Error('Missing parent market or wallet')
			const details = await loadTradingDetails(client, parent.questionLedgerAddress, owner)
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
			const securityPool = engine.getState().seededSecurityPool?.address
			if (securityPool === undefined) throw new Error('Missing auction security pool')
			const fork = await loadSecurityPoolForkSnapshot({ client: securityPoolReadClient(client), securityPool, owner, universeId: 0n, outcomeIndex: 1n })
			if (fork.branch === undefined) throw new Error('Missing auction branch')
			const snapshot = await loadSecurityPoolBranchAuction(client, securityPool, owner, fork.branch.universeId)
			const auction = snapshot.auction
			if (auction === undefined) throw new Error('Missing seeded auction')
			expect(auction).toMatchObject({ opened: true, finalized: false })
			const excluded = auction.bids.find(bid => bid.earlyRefundAttoEth > 0n)
			const binding = auction.bids.find(bid => bid.earlyRefundAttoEth === 0n)
			if (excluded === undefined || binding === undefined) throw new Error('Missing excluded or binding demand')
			expect(quoteSecurityPoolAuctionRefund(snapshot, excluded.id)).toBe(excluded.lots * auction.lotAttoEth)
			expect(() => quoteSecurityPoolAuctionRefund(snapshot, binding.id)).toThrow('may still win')
		} finally {
			resetActiveEnvironmentForTesting()
		}
	},
	simulationSetupTimeoutMs,
)
