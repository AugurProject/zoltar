/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createBootstrappedSimulationBackendWithRetry, resetSelectedAccountAndTransactionDelay, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulationTestUtils.js'
import { loadZoltarUniverseSummary, loadAllZoltarQuestions } from '../../protocol/index.js'

void describe('two-question simulation backend', () => {
	let backend: SimulationBackend

	beforeAll(async () => {
		backend = await createBootstrappedSimulationBackendWithRetry('two-questions')
		await backend.setTransactionDelayMilliseconds(0)
	}, 180_000)

	beforeEach(async () => {
		await resetSelectedAccountAndTransactionDelay(backend)
	}, 30_000)

	afterAll(async () => {
		if (backend !== undefined) await backend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	void test('bootstraps two binary questions and an unforked universe', async () => {
		const client = backend.createReadClient()
		const universe = await loadZoltarUniverseSummary(client, 0n)
		const questions = await loadAllZoltarQuestions(client)
		expect(universe?.hasForked).toBe(false)
		expect(questions).toHaveLength(2)
		expect(questions.every(question => question.marketType === 'binary')).toBe(true)
		expect(questions.every(question => question.outcomeLabels.length === 2)).toBe(true)
	}, 60_000)
})
