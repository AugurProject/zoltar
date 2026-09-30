/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { isLiquidationBeyondMinPriceDistance, isVaultHealthyAtFactor } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/liquidation.js'
import { getVaultRedeemRepGuardMessage } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityVaultGuards.js'
import { loadOracleManagerDetails } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'
import { loadReportingDetails } from '@zoltar/ui-statoblast-shared/protocol/reporting.js'
import { loadAllSecurityPools, loadSecurityVaultDetails } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { isSecurityPoolEscalationResolved } from '@zoltar/ui-statoblast-shared/protocol/securityVault.js'

const BPS = 10_000n

function requireAccount(backend: SimulationBackend, index: number) {
	const account = backend.accounts[index]
	if (account === undefined) throw new Error(`Expected simulation QA account ${index.toString()}`)
	return account
}

async function loadOnlyPool(backend: SimulationBackend, title: string) {
	const pools = await loadAllSecurityPools(backend.createReadClient())
	expect(pools.map(pool => pool.marketDetails.title)).toEqual([title])
	const pool = pools[0]
	if (pool === undefined) throw new Error(`Expected the ${title} pool`)
	return pool
}

void describe('production workflow simulation scenarios', () => {
	let endedPoolBackend: SimulationBackend
	let liquidationDistanceBackend: SimulationBackend

	beforeAll(async () => {
		const [nextEndedPoolBackend, nextLiquidationDistanceBackend] = await Promise.all([createBootstrappedSimulationBackendWithRetry('ended-pool-commitment', 1, 'statoblast'), createBootstrappedSimulationBackendWithRetry('liquidation-distance', 1, 'statoblast')])
		endedPoolBackend = nextEndedPoolBackend
		liquidationDistanceBackend = nextLiquidationDistanceBackend
	}, 180_000)

	afterAll(async () => {
		if (endedPoolBackend !== undefined) await endedPoolBackend.dispose()
		if (liquidationDistanceBackend !== undefined) await liquidationDistanceBackend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	void test('ended-pool-commitment resolves the question while the committed vault can only exit through its commitment', async () => {
		activateSimulationBackendProfile(endedPoolBackend)
		const readClient = endedPoolBackend.createReadClient()
		const primaryAccount = requireAccount(endedPoolBackend, 0)
		const pool = await loadOnlyPool(endedPoolBackend, 'Will this resolve? (ended pool)')
		const reporting = await loadReportingDetails(readClient, pool.securityPoolAddress, primaryAccount)
		const vault = await loadSecurityVaultDetails(readClient, pool.securityPoolAddress, primaryAccount)
		if (vault === undefined) throw new Error('Expected the committed vault')

		expect(endedPoolBackend.currentScenario).toBe('ended-pool-commitment')
		expect(reporting.questionOutcome).toBe('yes')
		expect(reporting.systemState).toBe('operational')
		expect(await isSecurityPoolEscalationResolved(readClient, pool.securityPoolAddress)).toBe(true)
		expect(vault.vaultAttoRepBacking).toBe(10_000n * 10n ** 18n)
		expect(vault.underwritingLimitAttoEth).toBe(80n * 10n ** 18n)
		expect(vault.disputeStakedAttoRep).toBe(0n)
		expect(getVaultRedeemRepGuardMessage({ disputeStakedAttoRep: vault.disputeStakedAttoRep, redeemableRepAmountAttoRep: vault.vaultAttoRepBacking, underwritingLimitAttoEth: vault.underwritingLimitAttoEth })).toContain('Set your commitment limit to 0 ETH')
	}, 60_000)

	void test('liquidation-distance prices one unhealthy vault inside the minimum distance and one past it', async () => {
		activateSimulationBackendProfile(liquidationDistanceBackend)
		const readClient = liquidationDistanceBackend.createReadClient()
		const pool = await loadOnlyPool(liquidationDistanceBackend, 'Will this resolve? (liquidation distance)')
		const manager = await loadOracleManagerDetails(readClient, pool.managerAddress)
		const minPriceDistanceBps = manager.minLiquidationPriceDistanceBps
		if (minPriceDistanceBps === undefined) throw new Error('Expected the coordinator minimum liquidation distance')

		expect(liquidationDistanceBackend.currentScenario).toBe('liquidation-distance')
		expect(manager.isPriceValid).toBe(true)
		expect(manager.lastPrice).toBe(4n * 10n ** 18n)
		expect(minPriceDistanceBps).toBe(1_000n)
		const expectations = [
			{ account: requireAccount(liquidationDistanceBackend, 0), beyondDistance: undefined, healthy: true },
			{ account: requireAccount(liquidationDistanceBackend, 1), beyondDistance: false, healthy: false },
			{ account: requireAccount(liquidationDistanceBackend, 2), beyondDistance: true, healthy: false },
		] as const
		for (const { account, beyondDistance, healthy } of expectations) {
			const vault = await loadSecurityVaultDetails(readClient, pool.securityPoolAddress, account)
			if (vault === undefined) throw new Error(`Expected the seeded vault ${account}`)
			const disputeStakedAttoRep = vault.disputeStakedAttoRep
			const vaultState = { disputeStakedAttoRep, openInterestAttoEth: vault.underwritingLimitAttoEth, poolHeldVaultRepBackingAttoRep: vault.vaultAttoRepBacking, poolSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps }
			expect(isVaultHealthyAtFactor({ ...vaultState, healthFactorBps: BPS, repPerEthPrice: manager.lastPrice })).toBe(healthy)
			if (beyondDistance !== undefined) expect(isLiquidationBeyondMinPriceDistance({ ...vaultState, currentPrice: manager.lastPrice, minPriceDistanceBps })).toBe(beyondDistance)
		}
	}, 60_000)
})
