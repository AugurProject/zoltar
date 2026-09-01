/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createBootstrappedSimulationBackendWithRetry, resetSelectedAccountAndTransactionDelay, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulationTestUtils.js'
import { loadZoltarUniverseSummary } from '../../protocol/index.js'

void describe('forked categorical simulation backend', () => {
	let backend: SimulationBackend

	beforeAll(async () => {
		backend = await createBootstrappedSimulationBackendWithRetry('forked-categorical')
		await backend.setTransactionDelayMilliseconds(0)
	}, 180_000)

	beforeEach(async () => {
		await resetSelectedAccountAndTransactionDelay(backend)
	}, 30_000)

	afterAll(async () => {
		if (backend !== undefined) await backend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	void test('bootstraps a forked five-way categorical universe with two deployed child universes', async () => {
		const universeSummary = await loadZoltarUniverseSummary(backend.createReadClient(), 0n)
		if (universeSummary === undefined) throw new Error('Expected the seeded genesis universe')

		expect(backend.currentScenario).toBe('forked-categorical')
		expect(universeSummary.hasForked).toBe(true)
		expect(universeSummary.forkQuestionDetails?.marketType).toBe('categorical')
		expect(universeSummary.forkQuestionDetails?.outcomeLabels).toHaveLength(5)
		expect(universeSummary.childUniverses.filter(child => child.exists)).toHaveLength(2)
	}, 60_000)
})
