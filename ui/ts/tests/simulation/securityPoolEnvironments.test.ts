/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { loadAllSecurityPools, loadSecurityVaultDetails } from '../../protocol/index.js'
import type { SimulationScenario } from '../../simulation/scenarios.js'
import { createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from './testUtils.js'

const SEEDED_REP_DEPOSIT = 10_000n * 10n ** 18n
const SEEDED_SECURITY_BOND_ALLOWANCE = 100n * 10n ** 18n

void describe('security-pool simulation backends', () => {
	let securityPoolBackend: SimulationBackend
	let securityPoolX2Backend: SimulationBackend
	let securityPoolX2AuctionBackend: SimulationBackend

	beforeAll(async () => {
		const backends = await Promise.all([createBootstrappedSimulationBackendWithRetry('security-pool', 1), createBootstrappedSimulationBackendWithRetry('securitypoolx2', 1), createBootstrappedSimulationBackendWithRetry('securitypoolx2-auction', 1)])
		const [nextSecurityPoolBackend, nextSecurityPoolX2Backend, nextSecurityPoolX2AuctionBackend] = backends
		if (nextSecurityPoolBackend === undefined || nextSecurityPoolX2Backend === undefined || nextSecurityPoolX2AuctionBackend === undefined) {
			throw new Error('Expected every seeded security-pool simulation backend')
		}
		securityPoolBackend = nextSecurityPoolBackend
		securityPoolX2Backend = nextSecurityPoolX2Backend
		securityPoolX2AuctionBackend = nextSecurityPoolX2AuctionBackend
		securityPoolBackend.setTransactionDelayMilliseconds(0)
		securityPoolX2Backend.setTransactionDelayMilliseconds(0)
		securityPoolX2AuctionBackend.setTransactionDelayMilliseconds(0)
	}, 180_000)

	afterAll(async () => {
		if (securityPoolBackend !== undefined) await securityPoolBackend.dispose()
		if (securityPoolX2Backend !== undefined) await securityPoolX2Backend.dispose()
		if (securityPoolX2AuctionBackend !== undefined) await securityPoolX2AuctionBackend.dispose()
	}, 30_000)

	void test('bootstraps seeded security-pool scenarios without reverting', async () => {
		const seededScenarios = [
			{ backend: securityPoolBackend, scenario: 'security-pool' },
			{ backend: securityPoolX2Backend, scenario: 'securitypoolx2' },
			{ backend: securityPoolX2AuctionBackend, scenario: 'securitypoolx2-auction' },
		] satisfies Array<{ backend: SimulationBackend; scenario: SimulationScenario }>
		for (const { backend, scenario } of seededScenarios) {
			expect(backend.currentScenario).toBe(scenario)
			const pools = await loadAllSecurityPools(backend.createReadClient())
			expect(pools.length).toBeGreaterThan(0)
		}
	}, 180_000)

	void test('bootstraps the security-pool scenario with one undercollateralized seeded vault', async () => {
		const backend = securityPoolBackend
		const primaryAccount = backend.accounts[0]
		if (primaryAccount === undefined) throw new Error('Expected seeded simulation QA accounts')

		const readClient = backend.createReadClient()
		const pools = await loadAllSecurityPools(readClient)
		const seededPool = pools[0]
		if (seededPool === undefined) throw new Error('Expected a seeded security pool')
		const seededVault = await loadSecurityVaultDetails(readClient, seededPool.securityPoolAddress, primaryAccount)
		if (seededVault === undefined) throw new Error('Expected a seeded security vault')

		expect(backend.currentScenario).toBe('security-pool')
		expect(pools).toHaveLength(1)
		expect(seededPool.vaultCount).toBe(1n)
		expect(seededPool.totalRepDeposit).toBe(SEEDED_REP_DEPOSIT)
		expect(seededPool.totalSecurityBondAllowance).toBe(SEEDED_SECURITY_BOND_ALLOWANCE)
		expect(seededVault.repDepositShare).toBe(SEEDED_REP_DEPOSIT)
		expect(seededVault.securityBondAllowance).toBe(SEEDED_SECURITY_BOND_ALLOWANCE)
	}, 60_000)
})
