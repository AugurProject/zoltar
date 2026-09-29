import { getSavedSimulationStateEnvelope, persistSavedSimulationState } from '../../simulation/savedStates.js'

function createMemoryStorage(): Storage {
	const records = new Map<string, string>()
	return {
		clear: () => records.clear(),
		getItem: key => records.get(key) ?? null,
		key: index => [...records.keys()][index] ?? null,
		get length() {
			return records.size
		},
		removeItem: key => {
			records.delete(key)
		},
		setItem: (key, value) => {
			records.set(key, value)
		},
	}
}

/** Parses a serialized simulation state through the public persist/read path using an in-memory Storage. */
export function parseSavedSimulationStateEnvelope(serialized: string) {
	const storage = createMemoryStorage()
	const record = persistSavedSimulationState(serialized, storage)
	const envelope = getSavedSimulationStateEnvelope(record.id, storage)
	if (envelope === undefined) throw new Error('Persisted simulation state could not be read back')
	return envelope
}
