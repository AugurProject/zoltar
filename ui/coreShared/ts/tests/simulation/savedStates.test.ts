/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { deleteSavedSimulationState, getSavedSimulationStateEnvelope, getSavedSimulationStateStorageSummary, persistSavedSimulationState, removeCorruptedSavedSimulationStates, serializeSavedSimulationStateEnvelope } from '../../simulation/savedStates.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { parseSavedSimulationStateEnvelope } from './savedStateStorage.js'

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

	test('reports unavailable storage without throwing', () => {
		const unavailableStorage: Storage = {
			length: 0,
			clear: () => undefined,
			getItem: () => {
				throw new DOMException('Storage unavailable', 'SecurityError')
			},
			key: () => null,
			removeItem: () => undefined,
			setItem: () => undefined,
		}

		expect(getSavedSimulationStateStorageSummary(unavailableStorage)).toEqual({
			records: [],
			warning: 'Saved simulation state storage is unavailable.',
		})
	})

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

	test('rejects array-shaped TEVM snapshots before they can corrupt a saved environment', () => {
		const malformedEnvelope: unknown = JSON.parse(
			createSerializedSavedState({
				name: 'Malformed snapshot',
				savedAt: '2026-06-02T12:34:56.000Z',
			}),
		)
		if (typeof malformedEnvelope !== 'object' || malformedEnvelope === null || Array.isArray(malformedEnvelope)) throw new Error('Expected an object-shaped saved state fixture')
		const state = Reflect.get(malformedEnvelope, 'state')
		if (typeof state !== 'object' || state === null || Array.isArray(state)) throw new Error('Expected an object-shaped saved state payload')
		Reflect.set(state, 'snapshot', [])
		const malformedSerialized = JSON.stringify(malformedEnvelope)
		if (malformedSerialized === undefined) throw new Error('Expected the malformed fixture to serialize')

		expect(() => parseSavedSimulationStateEnvelope(malformedSerialized)).toThrow('Saved simulation state is missing a valid TEVM snapshot')
	})

	describe('in browser storage', () => {
		let cleanupDom: (() => void) | undefined
		beforeEach(() => {
			cleanupDom = installDomEnvironment().cleanup
		})
		afterEach(() => {
			cleanupDom?.()
			cleanupDom = undefined
		})

		const SAVED_STATES_KEY = 'zoltar.simulation.savedStates'
		const BACKUP_KEY = 'zoltar.simulation.savedStates.corruptedBackup'
		const storedRecord = (id: string, name: string, savedAt: string, persistedAt?: string) => ({
			baseScenario: 'baseline',
			id,
			name,
			...(persistedAt === undefined ? {} : { persistedAt }),
			savedAt,
			serialized: createSerializedSavedState({ name, savedAt }),
		})
		const readBackups = () => {
			const backupValue = window.localStorage.getItem(BACKUP_KEY)
			expect(backupValue).not.toBeNull()
			if (backupValue === null) throw new Error('Expected corrupted saved-state backup to be written')
			return JSON.parse(backupValue)
		}

		test('persists, lists, and deletes saved states from local storage', () => {
			const first = persistSavedSimulationState(createSerializedSavedState({ name: 'Saved baseline', savedAt: '2026-06-02T12:34:56.000Z' }))
			const second = persistSavedSimulationState(createSerializedSavedState({ name: 'Saved baseline', savedAt: '2026-06-02T12:35:56.000Z' }))

			const records = getSavedSimulationStateStorageSummary().records
			expect(records).toHaveLength(2)
			expect(first.id).toBe('saved-baseline-20260602123456')
			expect(second.id).toBe('saved-baseline-20260602123556')
			expect(getSavedSimulationStateEnvelope(first.id)?.name).toBe('Saved baseline')

			expect(deleteSavedSimulationState(first.id)).toBe(true)
			expect(deleteSavedSimulationState('missing-state')).toBe(false)
			expect(listSavedSimulationStateRecordIds()).toEqual([second.id])
		})

		test('sorts imported saves by local persistence time instead of export time', () => {
			window.localStorage.setItem(SAVED_STATES_KEY, JSON.stringify([storedRecord('older-export-20260601123456', 'Older export', '2026-06-01T12:34:56.000Z', '2026-06-03T00:10:00.000Z'), storedRecord('newer-export-20260602123456', 'Newer export', '2026-06-02T12:34:56.000Z', '2026-06-03T00:00:00.000Z')]))

			expect(listSavedSimulationStateRecordIds()).toEqual(['older-export-20260601123456', 'newer-export-20260602123456'])
		})

		test('ignores corrupted saved-state storage records, then removes them while preserving valid saves', () => {
			window.localStorage.setItem(
				SAVED_STATES_KEY,
				JSON.stringify([
					storedRecord('saved-baseline-20260602123456', 'Saved baseline', '2026-06-02T12:34:56.000Z'),
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
			expect(removeCorruptedSavedSimulationStates()).toBe(1)
			expect(getSavedSimulationStateStorageSummary().warning).toBeUndefined()
			expect(listSavedSimulationStateRecordIds()).toEqual(['saved-baseline-20260602123456'])
			expect(removeCorruptedSavedSimulationStates()).toBe(0)
		})

		test('reports malformed saved-state storage with a generic warning', () => {
			window.localStorage.setItem(SAVED_STATES_KEY, '{bad json')

			expect(getSavedSimulationStateStorageSummary().warning).toBe('Saved simulation states in browser storage are corrupted.')
			expect(removeCorruptedSavedSimulationStates()).toBe(1)
			expect(getSavedSimulationStateStorageSummary().warning).toBeUndefined()
			expect(getSavedSimulationStateStorageSummary().records).toEqual([])
			expect(readBackups()).toEqual([
				expect.objectContaining({
					rawValue: '{bad json',
				}),
			])
		})

		test('keeps a bounded history of malformed saved-state storage backups', () => {
			window.localStorage.setItem(
				BACKUP_KEY,
				JSON.stringify([
					{ backedUpAt: '2026-06-03T00:00:05.000Z', rawValue: 'older-1' },
					{ backedUpAt: '2026-06-03T00:00:04.000Z', rawValue: 'older-2' },
					{ backedUpAt: '2026-06-03T00:00:03.000Z', rawValue: 'older-3' },
					{ backedUpAt: '2026-06-03T00:00:02.000Z', rawValue: 'older-4' },
					{ backedUpAt: '2026-06-03T00:00:01.000Z', rawValue: 'older-5' },
				]),
			)
			window.localStorage.setItem(SAVED_STATES_KEY, '{new-bad-json')

			expect(removeCorruptedSavedSimulationStates()).toBe(1)

			expect(readBackups()).toEqual([expect.objectContaining({ rawValue: '{new-bad-json' }), expect.objectContaining({ rawValue: 'older-1' }), expect.objectContaining({ rawValue: 'older-2' }), expect.objectContaining({ rawValue: 'older-3' }), expect.objectContaining({ rawValue: 'older-4' })])
		})
	})
})
