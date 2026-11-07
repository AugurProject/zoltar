/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { fetchSimulationScenarioSnapshot, isSimulationSnapshotManifest } from '../../simulation/scenarioSnapshots.js'

function createFetch(responses: Record<string, { body: string; status?: number }>) {
	const requested: string[] = []
	const fetchImplementation = async (input: Parameters<typeof fetch>[0]) => {
		const url = input instanceof Request ? input.url : input.toString()
		requested.push(url)
		const response = responses[url]
		if (response === undefined) return new Response('missing', { status: 404 })
		return new Response(response.body, { status: response.status ?? 200 })
	}
	return { fetchImplementation: Object.assign(fetchImplementation, { preconnect: () => undefined }), requested }
}

const workerPath = new URL('http://localhost:12347/statoblast/js/simulation/tevmWorker.worker.js')
const manifest = JSON.stringify({ generatedAt: '2026-11-02T00:00:00.000Z', key: 'abc', scenarios: { deployed: { file: 'deployed.json' } } })

describe('scenario snapshots', () => {
	test('loads the scenario file the manifest next to the worker names', async () => {
		const { fetchImplementation, requested } = createFetch({
			'http://localhost:12347/statoblast/js/simulation/snapshots/manifest.json': { body: manifest },
			'http://localhost:12347/statoblast/js/simulation/snapshots/deployed.json': { body: '{"version":1}' },
		})
		expect(await fetchSimulationScenarioSnapshot(workerPath, 'deployed', fetchImplementation)).toEqual({ manifestKey: 'abc', snapshot: '{"version":1}' })
		expect(requested).toEqual(['http://localhost:12347/statoblast/js/simulation/snapshots/manifest.json', 'http://localhost:12347/statoblast/js/simulation/snapshots/deployed.json'])
	})

	test('returns nothing without a manifest, for an unlisted scenario, or outside a served worker', async () => {
		const missing = createFetch({})
		expect(await fetchSimulationScenarioSnapshot(workerPath, 'deployed', missing.fetchImplementation)).toBeUndefined()
		const unlisted = createFetch({ 'http://localhost:12347/statoblast/js/simulation/snapshots/manifest.json': { body: manifest } })
		expect(await fetchSimulationScenarioSnapshot(workerPath, 'portfolio', unlisted.fetchImplementation)).toBeUndefined()
		expect(unlisted.requested).toHaveLength(1)
		const local = createFetch({})
		expect(await fetchSimulationScenarioSnapshot(new URL('file:///repo/ui/statoblast/ts/simulation/tevmWorker.ts'), 'deployed', local.fetchImplementation)).toBeUndefined()
		expect(local.requested).toEqual([])
	})

	test('rejects malformed manifests and unreadable snapshot files', async () => {
		const malformed = createFetch({ 'http://localhost:12347/statoblast/js/simulation/snapshots/manifest.json': { body: '{"scenarios":[]}' } })
		await expect(fetchSimulationScenarioSnapshot(workerPath, 'deployed', malformed.fetchImplementation)).rejects.toThrow('malformed')
		const unreadable = createFetch({ 'http://localhost:12347/statoblast/js/simulation/snapshots/manifest.json': { body: manifest }, 'http://localhost:12347/statoblast/js/simulation/snapshots/deployed.json': { body: 'nope', status: 500 } })
		await expect(fetchSimulationScenarioSnapshot(workerPath, 'deployed', unreadable.fetchImplementation)).rejects.toThrow('could not be loaded (500)')
		expect(isSimulationSnapshotManifest(JSON.parse(manifest))).toBe(true)
		expect(isSimulationSnapshotManifest({ generatedAt: 'x', key: 'k', scenarios: { deployed: { file: '' } } })).toBe(false)
	})
})
