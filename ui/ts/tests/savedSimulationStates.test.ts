/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { deleteSavedSimulationState, getSavedSimulationStateEnvelope, listSavedSimulationStateRecords, parseSavedSimulationStateEnvelope, persistSavedSimulationState, serializeSavedSimulationStateEnvelope } from '../simulation/savedStates.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

function createSerializedSavedState({ name, savedAt }: { name: string; savedAt: string }) {
	return serializeSavedSimulationStateEnvelope({
		baseScenario: 'baseline',
		name,
		savedAt,
		state: {
			blockCountSinceReset: 1n,
			currentTimestamp: 2n,
			queryDelayMilliseconds: 0,
			repPerEthPrice: 3n * 10n ** 18n,
			repPerUsdcPrice: 10n ** 6n,
			selectedAccount: '0x00000000000000000000000000000000000000a1',
			snapshot: {
				accounts: [],
			},
			transactionCountSinceReset: 4n,
			transactionDelayMilliseconds: 1000,
		},
		version: 1,
	})
}

describe('saved simulation states', () => {
	test('serializes and parses a versioned simulation state envelope', () => {
		const serialized = createSerializedSavedState({
			name: 'Saved baseline',
			savedAt: '2026-06-02T12:34:56.000Z',
		})

		const parsed = parseSavedSimulationStateEnvelope(serialized)

		expect(parsed.version).toBe(1)
		expect(parsed.name).toBe('Saved baseline')
		expect(parsed.state.blockCountSinceReset).toBe(1n)
	})

	test('rejects malformed saved state json', () => {
		expect(() => parseSavedSimulationStateEnvelope('{bad json')).toThrow('Failed to parse the saved simulation state JSON')
	})

	test('rejects unsupported saved state versions', () => {
		expect(() =>
			parseSavedSimulationStateEnvelope(
				JSON.stringify({
					baseScenario: 'baseline',
					name: 'Bad state',
					savedAt: '2026-06-02T12:34:56.000Z',
					state: {},
					version: 99,
				}),
			),
		).toThrow('Unsupported saved simulation state version: 99')
	})

	test('rejects invalid savedAt timestamps', () => {
		expect(() =>
			parseSavedSimulationStateEnvelope(
				JSON.stringify({
					baseScenario: 'baseline',
					name: 'Bad state',
					savedAt: 'not-a-date',
					state: {
						blockCountSinceReset: '1n',
						currentTimestamp: '2n',
						queryDelayMilliseconds: 0,
						repPerEthPrice: '3000000000000000000n',
						repPerUsdcPrice: '1000000n',
						selectedAccount: '0x00000000000000000000000000000000000000a1',
						snapshot: {},
						transactionCountSinceReset: '4n',
						transactionDelayMilliseconds: 1000,
					},
					version: 1,
				}),
			),
		).toThrow('Saved simulation state is missing a valid savedAt timestamp')
	})

	test('persists, lists, and deletes saved states from local storage', () => {
		const domEnvironment = installDomEnvironment()

		try {
			const first = persistSavedSimulationState(
				createSerializedSavedState({
					name: 'Saved baseline',
					savedAt: '2026-06-02T12:34:56.000Z',
				}),
			)
			const second = persistSavedSimulationState(
				createSerializedSavedState({
					name: 'Saved baseline',
					savedAt: '2026-06-02T12:35:56.000Z',
				}),
			)

			const records = listSavedSimulationStateRecords()
			expect(records).toHaveLength(2)
			expect(first.id).toBe('saved-baseline-20260602123456')
			expect(second.id).toBe('saved-baseline-20260602123556')
			expect(getSavedSimulationStateEnvelope(first.id)?.name).toBe('Saved baseline')

			expect(deleteSavedSimulationState(first.id)).toBe(true)
			expect(deleteSavedSimulationState('missing-state')).toBe(false)
			expect(listSavedSimulationStateRecords().map(record => record.id)).toEqual([second.id])
		} finally {
			domEnvironment.cleanup()
		}
	})

	test('ignores corrupted or invalid saved-state storage records', () => {
		const domEnvironment = installDomEnvironment()

		try {
			window.localStorage.setItem(
				'zoltar.simulation.savedStates',
				JSON.stringify([
					{
						baseScenario: 'baseline',
						id: 'saved-baseline-20260602123456',
						name: 'Saved baseline',
						savedAt: '2026-06-02T12:34:56.000Z',
						serialized: createSerializedSavedState({
							name: 'Saved baseline',
							savedAt: '2026-06-02T12:34:56.000Z',
						}),
					},
					{
						baseScenario: 'baseline',
						id: 'broken-state',
						name: 'Broken state',
						savedAt: '2026-06-02T12:35:56.000Z',
						serialized: '{bad json',
					},
				]),
			)

			expect(listSavedSimulationStateRecords().map(record => record.id)).toEqual(['saved-baseline-20260602123456'])
		} finally {
			domEnvironment.cleanup()
		}
	})
})
