/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { deleteSavedSimulationState, getSavedSimulationStateEnvelope, getSavedSimulationStateStorageSummary, parseSavedSimulationStateEnvelope, persistSavedSimulationState, removeCorruptedSavedSimulationStates, serializeSavedSimulationStateEnvelope } from '../../simulation/savedStates.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'

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
	const listSavedSimulationStateRecordIds = () => getSavedSimulationStateStorageSummary().records.map(record => record.id)

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

	test('round-trips names that look like bigint strings', () => {
		const serialized = createSerializedSavedState({
			name: '123n',
			savedAt: '2026-06-02T12:34:56.000Z',
		})

		const parsed = parseSavedSimulationStateEnvelope(serialized)

		expect(parsed.name).toBe('123n')
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

			const records = getSavedSimulationStateStorageSummary().records
			expect(records).toHaveLength(2)
			expect(first.id).toBe('saved-baseline-20260602123456')
			expect(second.id).toBe('saved-baseline-20260602123556')
			expect(getSavedSimulationStateEnvelope(first.id)?.name).toBe('Saved baseline')

			expect(deleteSavedSimulationState(first.id)).toBe(true)
			expect(deleteSavedSimulationState('missing-state')).toBe(false)
			expect(listSavedSimulationStateRecordIds()).toEqual([second.id])
		} finally {
			domEnvironment.cleanup()
		}
	})

	test('sorts imported saves by local persistence time instead of export time', () => {
		const domEnvironment = installDomEnvironment()

		try {
			window.localStorage.setItem(
				'zoltar.simulation.savedStates',
				JSON.stringify([
					{
						baseScenario: 'baseline',
						id: 'older-export-20260601123456',
						name: 'Older export',
						persistedAt: '2026-06-03T00:10:00.000Z',
						savedAt: '2026-06-01T12:34:56.000Z',
						serialized: createSerializedSavedState({
							name: 'Older export',
							savedAt: '2026-06-01T12:34:56.000Z',
						}),
					},
					{
						baseScenario: 'baseline',
						id: 'newer-export-20260602123456',
						name: 'Newer export',
						persistedAt: '2026-06-03T00:00:00.000Z',
						savedAt: '2026-06-02T12:34:56.000Z',
						serialized: createSerializedSavedState({
							name: 'Newer export',
							savedAt: '2026-06-02T12:34:56.000Z',
						}),
					},
				]),
			)

			expect(listSavedSimulationStateRecordIds()).toEqual(['older-export-20260601123456', 'newer-export-20260602123456'])
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

			expect(listSavedSimulationStateRecordIds()).toEqual(['saved-baseline-20260602123456'])
			expect(getSavedSimulationStateStorageSummary().warning).toBe('Ignored 1 corrupted saved simulation state in browser storage.')
		} finally {
			domEnvironment.cleanup()
		}
	})

	test('removes corrupted saved-state storage records while preserving valid saves', () => {
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

			expect(removeCorruptedSavedSimulationStates()).toBe(1)
			expect(getSavedSimulationStateStorageSummary().warning).toBeUndefined()
			expect(listSavedSimulationStateRecordIds()).toEqual(['saved-baseline-20260602123456'])
			expect(removeCorruptedSavedSimulationStates()).toBe(0)
		} finally {
			domEnvironment.cleanup()
		}
	})

	test('reports malformed saved-state storage with a generic warning', () => {
		const domEnvironment = installDomEnvironment()

		try {
			window.localStorage.setItem('zoltar.simulation.savedStates', '{bad json')

			expect(getSavedSimulationStateStorageSummary().warning).toBe('Saved simulation state storage is corrupted in browser storage.')
			expect(removeCorruptedSavedSimulationStates()).toBe(1)
			expect(getSavedSimulationStateStorageSummary().warning).toBeUndefined()
			expect(getSavedSimulationStateStorageSummary().records).toEqual([])
			const backupValue = window.localStorage.getItem('zoltar.simulation.savedStates.corruptedBackup')
			expect(backupValue).not.toBeNull()
			if (backupValue === null) throw new Error('Expected corrupted saved-state backup to be written')
			expect(JSON.parse(backupValue)).toEqual([
				expect.objectContaining({
					rawValue: '{bad json',
				}),
			])
		} finally {
			domEnvironment.cleanup()
		}
	})

	test('keeps a bounded history of malformed saved-state storage backups', () => {
		const domEnvironment = installDomEnvironment()

		try {
			window.localStorage.setItem(
				'zoltar.simulation.savedStates.corruptedBackup',
				JSON.stringify([
					{ backedUpAt: '2026-06-03T00:00:05.000Z', rawValue: 'older-1' },
					{ backedUpAt: '2026-06-03T00:00:04.000Z', rawValue: 'older-2' },
					{ backedUpAt: '2026-06-03T00:00:03.000Z', rawValue: 'older-3' },
					{ backedUpAt: '2026-06-03T00:00:02.000Z', rawValue: 'older-4' },
					{ backedUpAt: '2026-06-03T00:00:01.000Z', rawValue: 'older-5' },
				]),
			)
			window.localStorage.setItem('zoltar.simulation.savedStates', '{new-bad-json')

			expect(removeCorruptedSavedSimulationStates()).toBe(1)

			const backupValue = window.localStorage.getItem('zoltar.simulation.savedStates.corruptedBackup')
			expect(backupValue).not.toBeNull()
			if (backupValue === null) throw new Error('Expected corrupted saved-state backup history to be written')
			expect(JSON.parse(backupValue)).toEqual([expect.objectContaining({ rawValue: '{new-bad-json' }), expect.objectContaining({ rawValue: 'older-1' }), expect.objectContaining({ rawValue: 'older-2' }), expect.objectContaining({ rawValue: 'older-3' }), expect.objectContaining({ rawValue: 'older-4' })])
		} finally {
			domEnvironment.cleanup()
		}
	})
})
