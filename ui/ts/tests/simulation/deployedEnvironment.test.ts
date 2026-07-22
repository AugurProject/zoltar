/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { loadDeploymentStatusOracleSnapshot, loadZoltarUniverseSummary } from '../../protocol/index.js'
import { getDeploymentSteps } from '../../protocol/deployment.js'
import { createBootstrappedSimulationBackendWithRetry, resetSelectedAccountAndTransactionDelay, type SimulationBackend } from './testUtils.js'

const SIMULATION_REP_MINT_AMOUNT = 1_000_000n * 10n ** 18n

void describe('deployed simulation backend', () => {
	let deployedBackend: SimulationBackend

	beforeAll(async () => {
		deployedBackend = await createBootstrappedSimulationBackendWithRetry('deployed')
		deployedBackend.setTransactionDelayMilliseconds(0)
	}, 180_000)

	beforeEach(async () => {
		await resetSelectedAccountAndTransactionDelay(deployedBackend)
	}, 30_000)

	afterAll(async () => {
		if (deployedBackend !== undefined) await deployedBackend.dispose()
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

	void test('bootstraps the deployed scenario with app contracts already deployed', async () => {
		const deploymentSnapshot = await loadDeploymentStatusOracleSnapshot(deployedBackend.createReadClient())

		expect(deployedBackend.currentScenario).toBe('deployed')
		expect(deploymentSnapshot.augurStatoblastDeployed).toBe(true)
		expect(deploymentSnapshot.deploymentStatuses.every(step => step.deployed)).toBe(true)
	}, 30_000)
})
