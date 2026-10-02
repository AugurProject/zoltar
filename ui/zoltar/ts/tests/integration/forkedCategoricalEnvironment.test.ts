/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createBootstrappedSimulationBackendWithRetry, resetSelectedAccountAndTransactionDelay, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadZoltarUniverseSummary } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'

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

	void test('reads the universe overview without querying the fork question, ancestry, or children', async () => {
		const client = backend.createReadClient()
		const calls: string[] = []
		const readContract: typeof client.readContract = async request => {
			calls.push(request.functionName)
			return await client.readContract(request)
		}
		const overview = await loadZoltarUniverseSummary({ ...client, readContract }, 0n, undefined, { includeRelatedUniverses: false })
		expect(overview?.hasForked).toBe(true)
		expect(overview?.relatedUniversesLoaded).toBe(false)
		expect(overview?.childUniverses).toEqual([])
		expect(overview?.forkQuestionDetails).toBeUndefined()
		expect(calls).toEqual(['getUniverseTheoreticalSupplyAttoRep'])
	})

	void test('bootstraps a forked five-way categorical universe with two deployed child universes', async () => {
		const universeSummary = await loadZoltarUniverseSummary(backend.createReadClient(), 0n)
		if (universeSummary === undefined) throw new Error('Expected the seeded genesis universe')

		expect(backend.currentScenario).toBe('forked-categorical')
		expect(universeSummary.hasForked).toBe(true)
		expect(universeSummary.forkQuestionDetails?.marketType).toBe('categorical')
		expect(universeSummary.forkQuestionDetails?.outcomeLabels).toHaveLength(5)
		expect(universeSummary.childUniverses.filter(child => child.exists)).toHaveLength(2)
	}, 60_000)

	void test('names a deployed child universe by the fork outcome that created it', async () => {
		const genesis = await loadZoltarUniverseSummary(backend.createReadClient(), 0n)
		const child = genesis?.childUniverses.find(candidate => candidate.exists)
		if (child === undefined) throw new Error('Expected a deployed child universe')
		const childSummary = await loadZoltarUniverseSummary(backend.createReadClient(), child.universeId)

		expect(genesis?.lineage).toEqual([{ outcomeLabel: undefined, universeId: 0n }])
		expect(childSummary?.lineage).toEqual([
			{ outcomeLabel: undefined, universeId: 0n },
			{ outcomeLabel: child.outcomeLabel, universeId: child.universeId },
		])
	}, 60_000)
})
