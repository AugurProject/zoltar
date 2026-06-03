import { getErrorMessage } from '../lib/errors.js'
import { isSimulationScenario, type SimulationScenario } from './scenarios.js'

const SAVED_SIMULATION_STATES_STORAGE_KEY = 'zoltar.simulation.savedStates'

export const SAVED_SIMULATION_STATE_VERSION = 1 as const

export type SimulationSnapshotV1 = {
	blockCountSinceReset: bigint
	currentTimestamp: bigint
	queryDelayMilliseconds: number
	repPerEthPrice: bigint
	repPerUsdcPrice: bigint
	selectedAccount: string
	snapshot: Record<string, unknown>
	transactionCountSinceReset: bigint
	transactionDelayMilliseconds: number
}

export type SavedSimulationStateEnvelopeV1 = {
	baseScenario: SimulationScenario
	name: string
	savedAt: string
	state: SimulationSnapshotV1
	version: typeof SAVED_SIMULATION_STATE_VERSION
}

export type SavedSimulationStateRecord = {
	baseScenario: SimulationScenario
	id: string
	name: string
	savedAt: string
	serialized: string
}

export type SimulationSource =
	| {
			kind: 'scenario'
			scenario: SimulationScenario
	  }
	| {
			baseScenario: SimulationScenario
			kind: 'saved-state'
			name: string
			savedAt: string
			stateId: string
	  }

export type SimulationInitialization =
	| {
			kind: 'scenario'
			scenario: SimulationScenario
	  }
	| {
			envelope: SavedSimulationStateEnvelopeV1
			kind: 'saved-state'
			stateId: string
	  }

type SavedSimulationStateStorageRecord = {
	baseScenario: SimulationScenario
	id: string
	name: string
	savedAt: string
	serialized: string
}

class SavedSimulationStateError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SavedSimulationStateError'
	}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function getStorage(storage?: Storage) {
	if (storage !== undefined) return storage
	if (typeof window === 'undefined' || window.localStorage === undefined) throw new Error('Local storage is unavailable')
	return window.localStorage
}

function stringifySimulationValue(value: unknown) {
	const serialized = JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? `${item.toString()}n` : (item as never)), 2)
	if (serialized === undefined) throw new Error('Saved simulation state could not be serialized')
	return serialized
}

function parseSimulationValue(serialized: string) {
	return JSON.parse(serialized, (_key, value) => {
		if (typeof value === 'string' && /^-?\d+n$/.test(value)) return BigInt(value.slice(0, -1))
		return value
	})
}

function normalizeSavedStateName(name: string) {
	return name.trim().replace(/\s+/g, ' ')
}

function slugifySavedStateName(name: string) {
	const normalized = normalizeSavedStateName(name)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return normalized === '' ? 'saved-state' : normalized
}

function createSavedStateTimestamp(savedAt: string) {
	return savedAt.replace(/[^0-9]/g, '').slice(0, 14)
}

function isFiniteNonNegativeNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeBigInt(value: unknown) {
	return typeof value === 'bigint' && value >= 0n
}

function assertSavedStateEnvelope(value: unknown): asserts value is SavedSimulationStateEnvelopeV1 {
	if (!isObjectRecord(value)) throw new SavedSimulationStateError('Saved simulation state must be a JSON object')
	if (value['version'] !== SAVED_SIMULATION_STATE_VERSION) throw new SavedSimulationStateError(`Unsupported saved simulation state version: ${String(value['version'])}`)
	if (typeof value['name'] !== 'string' || normalizeSavedStateName(value['name']) === '') throw new SavedSimulationStateError('Saved simulation state is missing a name')
	if (typeof value['savedAt'] !== 'string' || value['savedAt'].trim() === '') throw new SavedSimulationStateError('Saved simulation state is missing a savedAt timestamp')
	if (Number.isNaN(Date.parse(value['savedAt']))) throw new SavedSimulationStateError('Saved simulation state is missing a valid savedAt timestamp')
	if (typeof value['baseScenario'] !== 'string' || !isSimulationScenario(value['baseScenario'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid baseScenario')
	if (!isObjectRecord(value['state'])) throw new SavedSimulationStateError('Saved simulation state is missing its state payload')
	const state = value['state']
	if (typeof state['selectedAccount'] !== 'string' || state['selectedAccount'].trim() === '') throw new SavedSimulationStateError('Saved simulation state is missing a selectedAccount')
	if (!isFiniteNonNegativeNumber(state['queryDelayMilliseconds'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid query delay')
	if (!isFiniteNonNegativeNumber(state['transactionDelayMilliseconds'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid transaction delay')
	if (!isNonNegativeBigInt(state['blockCountSinceReset'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid block count')
	if (!isNonNegativeBigInt(state['currentTimestamp'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid timestamp')
	if (!isNonNegativeBigInt(state['transactionCountSinceReset'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid transaction count')
	if (!isNonNegativeBigInt(state['repPerEthPrice']) || state['repPerEthPrice'] === 0n) throw new SavedSimulationStateError('Saved simulation state is missing a valid REP/ETH price')
	if (!isNonNegativeBigInt(state['repPerUsdcPrice']) || state['repPerUsdcPrice'] === 0n) throw new SavedSimulationStateError('Saved simulation state is missing a valid REP/USDC price')
	if (!isObjectRecord(state['snapshot'])) throw new SavedSimulationStateError('Saved simulation state is missing a valid TEVM snapshot')
}

function assertSavedStateRecord(value: unknown): asserts value is SavedSimulationStateStorageRecord {
	if (!isObjectRecord(value)) throw new SavedSimulationStateError('Saved simulation state record must be an object')
	if (typeof value['id'] !== 'string' || value['id'].trim() === '') throw new SavedSimulationStateError('Saved simulation state record is missing an id')
	if (typeof value['serialized'] !== 'string' || value['serialized'].trim() === '') throw new SavedSimulationStateError('Saved simulation state record is missing its serialized payload')
	if (typeof value['name'] !== 'string' || normalizeSavedStateName(value['name']) === '') throw new SavedSimulationStateError('Saved simulation state record is missing a name')
	if (typeof value['savedAt'] !== 'string' || value['savedAt'].trim() === '') throw new SavedSimulationStateError('Saved simulation state record is missing its savedAt timestamp')
	if (typeof value['baseScenario'] !== 'string' || !isSimulationScenario(value['baseScenario'])) throw new SavedSimulationStateError('Saved simulation state record is missing a valid baseScenario')
}

function parseSavedStateStorageRecords(serialized: string | null) {
	if (serialized === null || serialized.trim() === '') return []
	let parsed: unknown
	try {
		parsed = JSON.parse(serialized)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		return []
	}
	if (!Array.isArray(parsed)) return []
	const validRecords: SavedSimulationStateStorageRecord[] = []
	for (const item of parsed) {
		try {
			assertSavedStateRecord(item)
			parseSavedSimulationStateEnvelope(item.serialized)
			validRecords.push(item)
		} catch (error) {
			if (!(error instanceof SavedSimulationStateError)) throw error
			continue
		}
	}
	return validRecords
}

function writeSavedStateStorageRecords(records: readonly SavedSimulationStateStorageRecord[], storage?: Storage) {
	getStorage(storage).setItem(SAVED_SIMULATION_STATES_STORAGE_KEY, JSON.stringify(records))
}

function createSavedStateRecordId({ existingIds, name, savedAt }: { existingIds: ReadonlySet<string>; name: string; savedAt: string }) {
	const baseId = `${slugifySavedStateName(name)}-${createSavedStateTimestamp(savedAt)}`
	if (!existingIds.has(baseId)) return baseId
	let suffix = 2
	while (existingIds.has(`${baseId}-${suffix}`)) {
		suffix += 1
	}
	return `${baseId}-${suffix}`
}

function toSavedSimulationStateRecord(storageRecord: SavedSimulationStateStorageRecord): SavedSimulationStateRecord {
	return {
		baseScenario: storageRecord.baseScenario,
		id: storageRecord.id,
		name: storageRecord.name,
		savedAt: storageRecord.savedAt,
		serialized: storageRecord.serialized,
	}
}

export function serializeSavedSimulationStateEnvelope(envelope: SavedSimulationStateEnvelopeV1) {
	assertSavedStateEnvelope(envelope)
	return stringifySimulationValue(envelope)
}

export function parseSavedSimulationStateEnvelope(serialized: string) {
	let parsed: unknown
	try {
		parsed = parseSimulationValue(serialized)
	} catch (error) {
		throw new SavedSimulationStateError(getErrorMessage(error, 'Failed to parse the saved simulation state JSON'))
	}
	assertSavedStateEnvelope(parsed)
	return parsed
}

export function listSavedSimulationStateRecords(storage?: Storage) {
	return parseSavedStateStorageRecords(getStorage(storage).getItem(SAVED_SIMULATION_STATES_STORAGE_KEY))
		.map(toSavedSimulationStateRecord)
		.sort((left, right) => right.savedAt.localeCompare(left.savedAt))
}

function getSavedSimulationStateRecord(stateId: string, storage?: Storage) {
	return listSavedSimulationStateRecords(storage).find(record => record.id === stateId)
}

export function getSavedSimulationStateEnvelope(stateId: string, storage?: Storage) {
	const record = getSavedSimulationStateRecord(stateId, storage)
	if (record === undefined) return undefined
	return parseSavedSimulationStateEnvelope(record.serialized)
}

export function persistSavedSimulationState(serialized: string, storage?: Storage) {
	const parsedEnvelope = parseSavedSimulationStateEnvelope(serialized)
	const envelope = {
		...parsedEnvelope,
		name: normalizeSavedStateName(parsedEnvelope.name),
	}
	const normalizedSerialized = serializeSavedSimulationStateEnvelope(envelope)
	const currentRecords = parseSavedStateStorageRecords(getStorage(storage).getItem(SAVED_SIMULATION_STATES_STORAGE_KEY))
	const id = createSavedStateRecordId({
		existingIds: new Set(currentRecords.map(record => record.id)),
		name: envelope.name,
		savedAt: envelope.savedAt,
	})
	const nextRecord = {
		baseScenario: envelope.baseScenario,
		id,
		name: envelope.name,
		savedAt: envelope.savedAt,
		serialized: normalizedSerialized,
	} satisfies SavedSimulationStateStorageRecord
	writeSavedStateStorageRecords([...currentRecords, nextRecord], storage)
	return toSavedSimulationStateRecord(nextRecord)
}

export function deleteSavedSimulationState(stateId: string, storage?: Storage) {
	const currentRecords = parseSavedStateStorageRecords(getStorage(storage).getItem(SAVED_SIMULATION_STATES_STORAGE_KEY))
	const nextRecords = currentRecords.filter(record => record.id !== stateId)
	if (nextRecords.length === currentRecords.length) return false
	writeSavedStateStorageRecords(nextRecords, storage)
	return true
}
