/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { loadAllSecurityPools, loadDeploymentStatusOracleSnapshot, loadErc20Balance, loadSecurityVaultDetails, loadZoltarUniverseSummary } from '../contracts.js'
import { getDeploymentSteps } from '../contracts/deployment.js'
import { getWrongNetworkMessage, isSupportedAppChain } from '../lib/network.js'
import { getActiveBackend, initializeActiveEnvironment, installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting, shouldUseSimulationLocation } from '../lib/activeEnvironment.js'
import { SIMULATION_BLOCK_INTERVAL_SECONDS, SIMULATION_INITIAL_TIMESTAMP } from '../simulation/clock.js'
import { parseSavedSimulationStateEnvelope, persistSavedSimulationState, serializeSavedSimulationStateEnvelope } from '../simulation/savedStates.js'
import { createSimulationBackend } from '../simulation/tevmBackend.js'
import type { SimulationScenario } from '../simulation/scenarios.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

const DEFAULT_SIMULATION_REP_PER_ETH_PRICE = 3n * 10n ** 18n
const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n
const SEEDED_REP_DEPOSIT = 10_000n * 10n ** 18n
const SEEDED_SECURITY_BOND_ALLOWANCE = 100n * 10n ** 18n
type SimulationBackend = Awaited<ReturnType<typeof createSimulationBackend>>
afterEach(() => {
	resetActiveEnvironmentForTesting()
})

async function createBootstrappedSimulationBackendWithRetry(scenario: SimulationScenario, maxAttempts = 2) {
	let lastError: unknown = undefined
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const backend = await createSimulationBackend({ scenario })
		try {
			await backend.bootstrap()
			return backend
		} catch (error) {
			lastError = error
			await backend.dispose()
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`Failed to bootstrap ${scenario} simulation backend`)
}

async function resetSelectedAccountAndTransactionDelay(backend: SimulationBackend) {
	const primaryAccount = backend.accounts[0]
	if (primaryAccount !== undefined && backend.selectedAccount !== primaryAccount) await backend.selectAccount(primaryAccount)
	backend.setTransactionDelayMilliseconds(0)
}

void describe('active environment', () => {
	void test('uses the injected backend by default when no environment has been initialized', () => {
		expect(getActiveBackend().id).toBe('injected')
		expect(getActiveBackend().profile.id).toBe('mainnet')
	})

	void test('enables simulation mode when the explicit URL flag is present', () => {
		expect(shouldUseSimulationLocation({ hostname: 'localhost', search: '?simulate=1' })).toBe(true)
		expect(shouldUseSimulationLocation({ hostname: '127.0.0.1', search: '?foo=bar&simulate=1' })).toBe(true)
		expect(shouldUseSimulationLocation({ hostname: 'localhost', search: '?simulate=0' })).toBe(false)
		expect(shouldUseSimulationLocation({ hostname: 'example.com', search: '?foo=bar' })).toBe(false)
	})

	void test('intentionally allows simulation mode on production-style hostnames', () => {
		expect(shouldUseSimulationLocation({ hostname: 'example.com', search: '?simulate=1' })).toBe(true)
		expect(shouldUseSimulationLocation({ hash: '#/zoltar?simulate=1', hostname: 'example.com', search: '' })).toBe(true)
	})

	void test('treats both mainnet and simulation profiles as supported app chains', () => {
		expect(isSupportedAppChain('0x1')).toBe(true)

		const resetEnvironment = installActiveEnvironmentForTesting(
			createFakeBackend({
				profile: createFakeSimulationProfile(),
			}),
		)

		expect(isSupportedAppChain('0x539')).toBe(true)
		expect(getWrongNetworkMessage()).toBeUndefined()
		resetEnvironment()
	})

	void test('disposes an existing simulation controller when reinitializing into injected mode', async () => {
		let disposeCalls = 0
		const resetEnvironment = installActiveEnvironmentForTesting(
			createFakeBackend({
				profile: createFakeSimulationProfile(),
			}),
			{
				dispose: async () => {
					disposeCalls += 1
				},
			} as Awaited<ReturnType<typeof createSimulationBackend>>,
		)

		await initializeActiveEnvironment({ hostname: 'localhost', search: '' })

		expect(disposeCalls).toBe(1)
		expect(getActiveBackend().id).toBe('injected')
		resetEnvironment()
	})

	void test('initializes a saved simulation state from simState query params', async () => {
		const domEnvironment = installDomEnvironment()
		const record = persistSavedSimulationState(
			serializeSavedSimulationStateEnvelope({
				baseScenario: 'baseline',
				name: 'Saved baseline',
				savedAt: '2026-06-02T12:34:56.000Z',
				state: {
					blockCountSinceReset: 1n,
					currentTimestamp: 2n,
					queryDelayMilliseconds: 0,
					repPerEthPrice: DEFAULT_SIMULATION_REP_PER_ETH_PRICE,
					repPerUsdcPrice: 10n ** 6n,
					selectedAccount: '0x00000000000000000000000000000000000000a1',
					snapshot: {},
					transactionCountSinceReset: 3n,
					transactionDelayMilliseconds: 0,
				},
				version: 1,
			}),
		)

		try {
			const backend = await initializeActiveEnvironment({
				hash: `#/zoltar?simulate=1&simState=${record.id}&simScenario=securitypoolx2`,
				hostname: 'localhost',
				search: '',
			})
			if (backend.id !== 'simulation') throw new Error('Expected the simulation backend')
			const simulationBackend = backend as Awaited<ReturnType<typeof createSimulationBackend>>
			expect(simulationBackend.simulationSource.kind).toBe('saved-state')
			expect(simulationBackend.currentScenario).toBe('baseline')
		} finally {
			domEnvironment.cleanup()
		}
	})

	void test('falls back to baseline when a saved state is missing', async () => {
		const domEnvironment = installDomEnvironment()

		try {
			const backend = await initializeActiveEnvironment({
				hash: '#/zoltar?simulate=1&simState=missing-state',
				hostname: 'localhost',
				search: '',
			})
			if (backend.id !== 'simulation') throw new Error('Expected the simulation backend')
			const simulationBackend = backend as Awaited<ReturnType<typeof createSimulationBackend>>
			expect(simulationBackend.currentScenario).toBe('baseline')
			expect(simulationBackend.bootstrapError).toContain('could not be loaded')
		} finally {
			domEnvironment.cleanup()
		}
	})

	void test('falls back to baseline when a saved state record is invalid', async () => {
		const domEnvironment = installDomEnvironment()
		window.localStorage.setItem(
			'zoltar.simulation.savedStates',
			JSON.stringify([
				{
					baseScenario: 'baseline',
					id: 'broken-state',
					name: 'Broken state',
					savedAt: '2026-06-02T12:34:56.000Z',
					serialized: '{bad json',
				},
			]),
		)

		try {
			const backend = await initializeActiveEnvironment({
				hash: '#/zoltar?simulate=1&simState=broken-state',
				hostname: 'localhost',
				search: '',
			})
			if (backend.id !== 'simulation') throw new Error('Expected the simulation backend')
			const simulationBackend = backend as Awaited<ReturnType<typeof createSimulationBackend>>
			expect(simulationBackend.currentScenario).toBe('baseline')
			expect(simulationBackend.bootstrapError).toContain('could not be loaded')
		} finally {
			domEnvironment.cleanup()
		}
	})
})

void describe('simulation backend', () => {
	let coldBaselineBackend: SimulationBackend
	let warmBaselineBackend: SimulationBackend
	let deployedBackend: SimulationBackend
	let securityPoolBackend: SimulationBackend
	let securityPoolX2Backend: SimulationBackend
	let securityPoolX2AuctionBackend: SimulationBackend

	beforeAll(async () => {
		coldBaselineBackend = await createSimulationBackend({ scenario: 'baseline' })
		const [nextWarmBaselineBackend, nextDeployedBackend, nextSecurityPoolBackend, nextSecurityPoolX2Backend, nextSecurityPoolX2AuctionBackend] = await Promise.all([
			createBootstrappedSimulationBackendWithRetry('baseline'),
			createBootstrappedSimulationBackendWithRetry('deployed'),
			createBootstrappedSimulationBackendWithRetry('security-pool', 1),
			createBootstrappedSimulationBackendWithRetry('securitypoolx2', 1),
			createBootstrappedSimulationBackendWithRetry('securitypoolx2-auction', 1),
		])
		warmBaselineBackend = nextWarmBaselineBackend
		deployedBackend = nextDeployedBackend
		securityPoolBackend = nextSecurityPoolBackend
		securityPoolX2Backend = nextSecurityPoolX2Backend
		securityPoolX2AuctionBackend = nextSecurityPoolX2AuctionBackend
		warmBaselineBackend.setTransactionDelayMilliseconds(0)
		deployedBackend.setTransactionDelayMilliseconds(0)
		securityPoolBackend.setTransactionDelayMilliseconds(0)
		securityPoolX2Backend.setTransactionDelayMilliseconds(0)
		securityPoolX2AuctionBackend.setTransactionDelayMilliseconds(0)
	}, 180_000)

	beforeEach(async () => {
		await resetSelectedAccountAndTransactionDelay(coldBaselineBackend)
		await resetSelectedAccountAndTransactionDelay(warmBaselineBackend)
		await resetSelectedAccountAndTransactionDelay(deployedBackend)
	}, 30_000)

	afterAll(async () => {
		if (coldBaselineBackend !== undefined) await coldBaselineBackend.dispose()
		if (warmBaselineBackend !== undefined) await warmBaselineBackend.dispose()
		if (deployedBackend !== undefined) await deployedBackend.dispose()
		if (securityPoolBackend !== undefined) await securityPoolBackend.dispose()
		if (securityPoolX2Backend !== undefined) await securityPoolX2Backend.dispose()
		if (securityPoolX2AuctionBackend !== undefined) await securityPoolX2AuctionBackend.dispose()
	}, 30_000)

	void test('reports wallet presence and returns the selected account', async () => {
		const backend = coldBaselineBackend
		const primaryAccount = backend.accounts[0]
		if (primaryAccount === undefined) throw new Error('Expected a primary simulation QA account')

		expect(backend.id).toBe('simulation')
		expect(backend.hasWallet()).toBe(true)
		expect(await backend.getChainId()).toBe('0x539')
		expect(await backend.getAccounts()).toEqual([primaryAccount])
		expect(await backend.requestAccounts()).toEqual([primaryAccount])
		expect(backend.currentScenario).toBe('baseline')
		expect(backend.isBootstrapped).toBe(false)
		expect(backend.isBootstrapping).toBe(false)
		expect(backend.repPerEthPrice).toBe(DEFAULT_SIMULATION_REP_PER_ETH_PRICE)
		expect(backend.repPerUsdcPrice).toBe(10n ** 6n)
	})

	void test('tracks simulation bootstrap readiness state', async () => {
		const backend = await createSimulationBackend({ scenario: 'baseline' })

		try {
			const bootstrapPromise = backend.bootstrap()
			expect(backend.isBootstrapping).toBe(true)
			expect(backend.isBootstrapped).toBe(false)

			await backend.waitUntilReady()
			await bootstrapPromise

			expect(backend.isBootstrapping).toBe(false)
			expect(backend.isBootstrapped).toBe(true)
			expect(backend.bootstrapError).toBeUndefined()
		} finally {
			await backend.dispose()
		}
	}, 30_000)

	void test('boots every fresh baseline simulation from the fixed initial timestamp progression', async () => {
		const backendA = await createSimulationBackend({ scenario: 'baseline' })
		const backendB = await createSimulationBackend({ scenario: 'baseline' })

		try {
			await Promise.all([backendA.bootstrap(), backendB.bootstrap()])

			expect(backendA.currentTimestamp >= SIMULATION_INITIAL_TIMESTAMP).toBe(true)
			expect(backendA.currentTimestamp).toBe(backendB.currentTimestamp)
		} finally {
			await backendA.dispose()
			await backendB.dispose()
		}
	}, 30_000)

	void test('emits account-change events when switching QA accounts', async () => {
		const backend = coldBaselineBackend
		const nextAccount = backend.accounts[1]
		if (nextAccount === undefined) throw new Error('Expected a secondary simulation QA account')

		let notificationCount = 0
		const unsubscribe = backend.subscribeAccountsChanged(() => {
			notificationCount += 1
		})

		await backend.selectAccount(getAddress(nextAccount))

		expect(notificationCount).toBe(1)
		expect(await backend.getAccounts()).toEqual([nextAccount])
		expect(backend.selectedAccount).toBe(nextAccount)

		unsubscribe()
	})

	void test('bootstraps with funded REP and WETH but without deployed app infrastructure', async () => {
		const backend = warmBaselineBackend

		const primaryAccount = backend.accounts[0]
		if (primaryAccount === undefined) throw new Error('Expected seeded simulation QA accounts')

		const readClient = backend.createReadClient()
		const repCode = await readClient.getCode({
			address: backend.profile.genesisRepTokenAddress,
		})
		const wethCode = await readClient.getCode({
			address: backend.profile.wethAddress,
		})
		const repBalance = await loadErc20Balance(readClient, backend.profile.genesisRepTokenAddress, primaryAccount)
		const wethBalance = await loadErc20Balance(readClient, backend.profile.wethAddress, primaryAccount)
		const deploymentSnapshot = await loadDeploymentStatusOracleSnapshot(readClient)

		expect(repCode).not.toBe('0x')
		expect(wethCode).not.toBe('0x')
		expect(repBalance > 0n).toBe(true)
		expect(wethBalance > 0n).toBe(true)
		expect(deploymentSnapshot.augurPlaceHolderDeployed).toBe(false)
		expect(deploymentSnapshot.deploymentStatuses.every(step => step.deployed === false)).toBe(true)
	}, 30_000)

	void test('mints REP to the selected QA account without changing simulation block or transaction counters', async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('baseline')

		try {
			const primaryAccount = backend.accounts[0]
			const secondaryAccount = backend.accounts[1]
			if (primaryAccount === undefined || secondaryAccount === undefined) {
				throw new Error('Expected seeded simulation QA accounts')
			}

			const readClient = backend.createReadClient()
			const primaryBalanceBefore = await loadErc20Balance(readClient, backend.profile.genesisRepTokenAddress, primaryAccount)
			const secondaryBalanceBefore = await loadErc20Balance(readClient, backend.profile.genesisRepTokenAddress, secondaryAccount)
			const blockBefore = await readClient.getBlock()
			const blockCountBefore = backend.blockCountSinceReset
			const timestampBefore = backend.currentTimestamp
			const transactionCountBefore = backend.transactionCountSinceReset

			await backend.selectAccount(secondaryAccount)
			await backend.mintRep(SIMULATION_REP_MINT_AMOUNT)

			const primaryBalanceAfter = await loadErc20Balance(readClient, backend.profile.genesisRepTokenAddress, primaryAccount)
			const secondaryBalanceAfter = await loadErc20Balance(readClient, backend.profile.genesisRepTokenAddress, secondaryAccount)
			const blockAfter = await readClient.getBlock()

			expect(primaryBalanceAfter).toBe(primaryBalanceBefore)
			expect(secondaryBalanceAfter).toBe(secondaryBalanceBefore + SIMULATION_REP_MINT_AMOUNT)
			expect(blockAfter.number).toBe(blockBefore.number)
			expect(blockAfter.timestamp).toBe(blockBefore.timestamp)
			expect(backend.blockCountSinceReset).toBe(blockCountBefore)
			expect(backend.currentTimestamp).toBe(timestampBefore)
			expect(backend.transactionCountSinceReset).toBe(transactionCountBefore)
		} finally {
			await backend.dispose()
		}
	}, 30_000)

	void test('keeps the deployed-scenario fork threshold in sync after minting REP', async () => {
		const backend = deployedBackend

		const readClient = backend.createReadClient()
		const zoltarStep = getDeploymentSteps().find(step => step.id === 'zoltar')
		if (zoltarStep === undefined) throw new Error('Expected the Zoltar deployment step')
		const universeSummaryBefore = await loadZoltarUniverseSummary(readClient, 0n)
		if (universeSummaryBefore === undefined) {
			throw new Error('Expected the genesis Zoltar universe to be available in the deployed scenario')
		}
		const zoltarBalanceBefore = await readClient.getBalance({ address: zoltarStep.address })

		await backend.mintRep(SIMULATION_REP_MINT_AMOUNT)

		const universeSummaryAfter = await loadZoltarUniverseSummary(readClient, 0n)
		if (universeSummaryAfter === undefined) {
			throw new Error('Expected the genesis Zoltar universe after minting REP')
		}
		const zoltarBalanceAfter = await readClient.getBalance({ address: zoltarStep.address })

		expect(universeSummaryAfter.totalTheoreticalSupply).toBe(universeSummaryBefore.totalTheoreticalSupply + SIMULATION_REP_MINT_AMOUNT)
		expect(universeSummaryAfter.forkThreshold).toBe(universeSummaryBefore.forkThreshold + SIMULATION_REP_MINT_AMOUNT / 20n)
		expect(zoltarBalanceAfter).toBe(zoltarBalanceBefore)
	}, 60_000)

	void test('submits simulation writes without deprecated Tevm transaction RPC warnings', async () => {
		const backend = await createSimulationBackend({ scenario: 'baseline' })
		await backend.bootstrap()

		try {
			const fromAccount = backend.accounts[0]
			const toAccount = backend.accounts[1]
			if (fromAccount === undefined || toAccount === undefined) throw new Error('Expected seeded simulation QA accounts')

			const writeClient = backend.createWriteClient(fromAccount)
			const hash = await writeClient.sendTransaction({
				to: getAddress(toAccount),
				value: 1n,
			})
			const receipt = await writeClient.waitForTransactionReceipt({ hash })

			expect(receipt.transactionHash).toBe(hash)
			expect(receipt.status).toBe('success')
		} finally {
			await backend.dispose()
		}
	}, 30_000)

	void test('tracks simulation block, transaction, and time state as controls are used', async () => {
		const backend = await createSimulationBackend({ scenario: 'baseline' })
		await backend.bootstrap()

		try {
			const fromAccount = backend.accounts[0]
			const toAccount = backend.accounts[1]
			if (fromAccount === undefined || toAccount === undefined) throw new Error('Expected seeded simulation QA accounts')

			const initialTimestamp = backend.currentTimestamp
			const initialBlockCount = backend.blockCountSinceReset
			const initialTransactionCount = backend.transactionCountSinceReset
			expect(initialBlockCount > 0n).toBe(true)
			expect(initialTransactionCount > 0n).toBe(true)

			const writeClient = backend.createWriteClient(fromAccount)
			const hash = await writeClient.sendTransaction({
				to: getAddress(toAccount),
				value: 1n,
			})
			await writeClient.waitForTransactionReceipt({ hash })

			expect(backend.blockCountSinceReset).toBe(initialBlockCount + 1n)
			expect(backend.transactionCountSinceReset).toBe(initialTransactionCount + 1n)
			expect(backend.currentTimestamp).toBe(initialTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS)

			await backend.mineBlock()
			expect(backend.blockCountSinceReset).toBe(initialBlockCount + 2n)
			expect(backend.currentTimestamp).toBe(initialTimestamp + 2n * SIMULATION_BLOCK_INTERVAL_SECONDS)

			await backend.advanceTime(60n * 60n)
			expect(backend.blockCountSinceReset).toBe(initialBlockCount + 3n)
			expect(backend.currentTimestamp).toBe(initialTimestamp + 2n * SIMULATION_BLOCK_INTERVAL_SECONDS + 60n * 60n)
		} finally {
			await backend.dispose()
		}
	}, 30_000)

	void test('applies the configured simulation transaction receipt delay', async () => {
		const backend = await createSimulationBackend({ scenario: 'baseline' })
		await backend.bootstrap()

		try {
			const fromAccount = backend.accounts[0]
			const toAccount = backend.accounts[1]
			if (fromAccount === undefined || toAccount === undefined) throw new Error('Expected seeded simulation QA accounts')

			backend.setTransactionDelayMilliseconds(250)
			expect(backend.transactionDelayMilliseconds).toBe(250)

			const writeClient = backend.createWriteClient(fromAccount)
			const hash = await writeClient.sendTransaction({
				to: getAddress(toAccount),
				value: 1n,
			})
			const startTime = performance.now()
			await writeClient.waitForTransactionReceipt({ hash })
			const elapsedMilliseconds = performance.now() - startTime

			expect(elapsedMilliseconds >= 200).toBe(true)
		} finally {
			await backend.dispose()
		}
	}, 30_000)

	void test('tracks the configured simulation REP/ETH mock price and resets it to the shared default', async () => {
		const backend = await createSimulationBackend({ scenario: 'baseline' })
		await backend.bootstrap()

		backend.setRepPerEthPrice(2n * 10n ** 18n)
		expect(backend.repPerEthPrice).toBe(2n * 10n ** 18n)
		backend.setRepPerUsdcPrice(7n * 10n ** 6n)
		expect(backend.repPerUsdcPrice).toBe(7n * 10n ** 6n)

		await backend.reset()
		expect(backend.repPerEthPrice).toBe(DEFAULT_SIMULATION_REP_PER_ETH_PRICE)
		expect(backend.repPerUsdcPrice).toBe(10n ** 6n)
	}, 30_000)

	void test('exports and restores a custom saved simulation state', async () => {
		const sourceBackend = await createSimulationBackend({ scenario: 'baseline' })
		await sourceBackend.bootstrap()

		try {
			const secondaryAccount = sourceBackend.accounts[1]
			if (secondaryAccount === undefined) throw new Error('Expected a secondary simulation QA account')

			sourceBackend.setQueryDelayMilliseconds(250)
			sourceBackend.setTransactionDelayMilliseconds(0)
			sourceBackend.setRepPerEthPrice(2n * 10n ** 18n)
			await sourceBackend.selectAccount(secondaryAccount)
			await sourceBackend.mintRep(SIMULATION_REP_MINT_AMOUNT)

			const restoredBackend = await createSimulationBackend({
				savedState: parseSavedSimulationStateEnvelope(await sourceBackend.exportState('Saved baseline')),
				savedStateId: 'saved-baseline-20260602123456',
			})
			await restoredBackend.bootstrap()

			try {
				expect(restoredBackend.simulationSource.kind).toBe('saved-state')
				expect(restoredBackend.selectedAccount).toBe(secondaryAccount)
				expect(restoredBackend.queryDelayMilliseconds).toBe(250)
				expect(restoredBackend.transactionDelayMilliseconds).toBe(0)
				expect(restoredBackend.repPerEthPrice).toBe(2n * 10n ** 18n)
				const repBalance = await loadErc20Balance(restoredBackend.createReadClient(), restoredBackend.profile.genesisRepTokenAddress, secondaryAccount)
				expect(repBalance >= SIMULATION_REP_MINT_AMOUNT).toBe(true)

				await restoredBackend.reset()
				expect(restoredBackend.selectedAccount).toBe(secondaryAccount)
				expect(restoredBackend.queryDelayMilliseconds).toBe(250)
				expect(restoredBackend.repPerEthPrice).toBe(2n * 10n ** 18n)
			} finally {
				await restoredBackend.dispose()
			}
		} finally {
			await sourceBackend.dispose()
		}
	}, 60_000)

	void test('bootstraps the deployed scenario with app contracts already deployed', async () => {
		const backend = deployedBackend

		const deploymentSnapshot = await loadDeploymentStatusOracleSnapshot(backend.createReadClient())

		expect(backend.currentScenario).toBe('deployed')
		expect(deploymentSnapshot.augurPlaceHolderDeployed).toBe(true)
		expect(deploymentSnapshot.deploymentStatuses.every(step => step.deployed)).toBe(true)
	}, 30_000)

	void test('bootstraps seeded security-pool scenarios without reverting', async () => {
		const seededScenarios = [
			{ backend: securityPoolBackend, scenario: 'security-pool' },
			{ backend: securityPoolX2Backend, scenario: 'securitypoolx2' },
			{ backend: securityPoolX2AuctionBackend, scenario: 'securitypoolx2-auction' },
		] satisfies Array<{ backend: SimulationBackend; scenario: SimulationScenario }>
		for (const { backend, scenario } of seededScenarios) {
			expect(backend.currentScenario).toBe(scenario)
			const readClient = backend.createReadClient()
			const pools = await loadAllSecurityPools(readClient)
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
