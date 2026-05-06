/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { loadAllSecurityPools, loadDeploymentStatusOracleSnapshot, loadErc20Balance, loadSecurityVaultDetails } from '../contracts.js'
import { getWrongNetworkMessage, isSupportedAppChain } from '../lib/network.js'
import { getActiveBackend, resetActiveEnvironmentForTesting, setActiveEnvironmentForTesting, shouldUseSimulationLocation } from '../lib/activeEnvironment.js'
import { createSimulationBackend } from '../simulation/tevmBackend.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'

afterEach(() => {
	resetActiveEnvironmentForTesting()
})

void describe('active environment', () => {
	void test('uses the injected backend by default when no environment has been initialized', () => {
		expect(getActiveBackend().id).toBe('injected')
		expect(getActiveBackend().profile.id).toBe('mainnet')
	})

	void test('enables simulation mode whenever ?simulate=1 is present', () => {
		expect(shouldUseSimulationLocation({ hostname: 'localhost', search: '?simulate=1' })).toBe(true)
		expect(shouldUseSimulationLocation({ hostname: '127.0.0.1', search: '?foo=bar&simulate=1' })).toBe(true)
		expect(shouldUseSimulationLocation({ hostname: 'example.com', search: '?simulate=1' })).toBe(true)
		expect(shouldUseSimulationLocation({ hostname: 'localhost', search: '?simulate=0' })).toBe(false)
		expect(shouldUseSimulationLocation({ hostname: 'example.com', search: '?foo=bar' })).toBe(false)
	})

	void test('treats both mainnet and simulation profiles as supported app chains', () => {
		expect(isSupportedAppChain('0x1')).toBe(true)

		setActiveEnvironmentForTesting(
			createFakeBackend({
				profile: createFakeSimulationProfile(),
			}),
		)

		expect(isSupportedAppChain('0x539')).toBe(true)
		expect(getWrongNetworkMessage()).toBeUndefined()
	})
})

void describe('simulation backend', () => {
	void test('reports wallet presence and returns the selected account', async () => {
		const backend = await createSimulationBackend({ scenario: 'base' })
		const primaryAccount = backend.accounts[0]
		if (primaryAccount === undefined) {
			throw new Error('Expected a primary simulation QA account')
		}

		expect(backend.id).toBe('simulation')
		expect(backend.hasWallet()).toBe(true)
		expect(await backend.getChainId()).toBe('0x539')
		expect(await backend.getAccounts()).toEqual([primaryAccount])
		expect(await backend.requestAccounts()).toEqual([primaryAccount])
		expect(backend.currentScenario).toBe('base')
		expect(backend.isBootstrapped).toBe(false)
		expect(backend.isBootstrapping).toBe(false)
	})

	void test('tracks simulation bootstrap readiness state', async () => {
		const backend = await createSimulationBackend({ scenario: 'base' })

		const bootstrapPromise = backend.bootstrap()
		expect(backend.isBootstrapping).toBe(true)
		expect(backend.isBootstrapped).toBe(false)

		await backend.waitUntilReady()
		await bootstrapPromise

		expect(backend.isBootstrapping).toBe(false)
		expect(backend.isBootstrapped).toBe(true)
		expect(backend.bootstrapError).toBeUndefined()
	}, 30_000)

	void test('emits account-change events when switching QA accounts', async () => {
		const backend = await createSimulationBackend({ scenario: 'base' })
		const nextAccount = backend.accounts[1]
		if (nextAccount === undefined) {
			throw new Error('Expected a secondary simulation QA account')
		}

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
		const backend = await createSimulationBackend({ scenario: 'base' })
		await backend.bootstrap()

		const primaryAccount = backend.accounts[0]
		if (primaryAccount === undefined) {
			throw new Error('Expected seeded simulation QA accounts')
		}

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

	void test('submits simulation writes without deprecated Tevm transaction RPC warnings', async () => {
		const backend = await createSimulationBackend({ scenario: 'base' })
		await backend.bootstrap()
		const fromAccount = backend.accounts[0]
		const toAccount = backend.accounts[1]
		if (fromAccount === undefined || toAccount === undefined) {
			throw new Error('Expected seeded simulation QA accounts')
		}

		const writeClient = backend.createWriteClient(fromAccount)
		const hash = await writeClient.sendTransaction({
			to: getAddress(toAccount),
			value: 1n,
		})
		const receipt = await writeClient.waitForTransactionReceipt({ hash })

		expect(receipt.transactionHash).toBe(hash)
		expect(receipt.status).toBe('success')
	}, 30_000)

	void test('tracks simulation block, transaction, and time state as controls are used', async () => {
		const backend = await createSimulationBackend({ scenario: 'base' })
		await backend.bootstrap()
		const fromAccount = backend.accounts[0]
		const toAccount = backend.accounts[1]
		if (fromAccount === undefined || toAccount === undefined) {
			throw new Error('Expected seeded simulation QA accounts')
		}

		const initialTimestamp = backend.currentTimestamp
		expect(backend.blockCountSinceReset).toBe(0n)
		expect(backend.transactionCountSinceReset).toBe(0n)

		const writeClient = backend.createWriteClient(fromAccount)
		const hash = await writeClient.sendTransaction({
			to: getAddress(toAccount),
			value: 1n,
		})
		await writeClient.waitForTransactionReceipt({ hash })

		expect(backend.blockCountSinceReset).toBe(1n)
		expect(backend.transactionCountSinceReset).toBe(1n)

		await backend.mineBlock()
		expect(backend.blockCountSinceReset).toBe(2n)

		await backend.advanceTime(60n * 60n)
		expect(backend.blockCountSinceReset).toBe(3n)
		expect(backend.currentTimestamp > initialTimestamp).toBe(true)
	}, 30_000)

	void test('applies the configured simulation transaction receipt delay', async () => {
		const backend = await createSimulationBackend({ scenario: 'base' })
		await backend.bootstrap()
		const fromAccount = backend.accounts[0]
		const toAccount = backend.accounts[1]
		if (fromAccount === undefined || toAccount === undefined) {
			throw new Error('Expected seeded simulation QA accounts')
		}

		backend.setTransactionDelayMilliseconds(250)
		expect(backend.transactionDelayMilliseconds).toBe(250)

		const writeClient = backend.createWriteClient(fromAccount)
		const hash = await writeClient.sendTransaction({
			to: getAddress(toAccount),
			value: 1n,
		})
		const startTime = Date.now()
		await writeClient.waitForTransactionReceipt({ hash })
		const elapsedMilliseconds = Date.now() - startTime

		expect(elapsedMilliseconds >= 200).toBe(true)
	}, 30_000)

	void test('bootstraps the deployed scenario with app contracts already deployed', async () => {
		const backend = await createSimulationBackend({ scenario: 'deployed' })
		await backend.bootstrap()

		const deploymentSnapshot = await loadDeploymentStatusOracleSnapshot(backend.createReadClient())

		expect(backend.currentScenario).toBe('deployed')
		expect(deploymentSnapshot.augurPlaceHolderDeployed).toBe(true)
		expect(deploymentSnapshot.deploymentStatuses.every(step => step.deployed)).toBe(true)
	}, 30_000)

	void test('bootstraps the security-pool scenario with one undercollateralized seeded vault', async () => {
		const backend = await createSimulationBackend({ scenario: 'security-pool' })
		await backend.bootstrap()
		const primaryAccount = backend.accounts[0]
		if (primaryAccount === undefined) {
			throw new Error('Expected seeded simulation QA accounts')
		}

		const readClient = backend.createReadClient()
		const pools = await loadAllSecurityPools(readClient)
		const seededPool = pools[0]
		if (seededPool === undefined) {
			throw new Error('Expected a seeded security pool')
		}
		const seededVault = await loadSecurityVaultDetails(readClient, seededPool.securityPoolAddress, primaryAccount)
		if (seededVault === undefined) {
			throw new Error('Expected a seeded security vault')
		}

		expect(backend.currentScenario).toBe('security-pool')
		expect(pools).toHaveLength(1)
		expect(seededPool.vaultCount).toBe(1n)
		expect(seededPool.totalRepDeposit).toBe(10_000n * 10n ** 18n)
		expect(seededPool.totalSecurityBondAllowance).toBe(2_500n * 10n ** 18n)
		expect(seededVault.repDepositShare).toBe(10_000n * 10n ** 18n)
		expect(seededVault.securityBondAllowance).toBe(2_500n * 10n ** 18n)
	}, 60_000)
})
