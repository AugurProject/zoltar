import { getErrorMessage } from '../lib/errors.js'
import { isSimulationScenario, type SimulationScenario } from './scenarios.js'

const SAVED_SIMULATION_STATES_STORAGE_KEY = 'zoltar.simulation.savedStates'
const SAVED_SIMULATION_STATES_CORRUPTED_BACKUP_STORAGE_KEY = 'zoltar.simulation.savedStates.corruptedBackup'
const MAX_CORRUPTED_SAVED_STATE_BACKUPS = 5

const SAVED_SIMULATION_STATE_VERSION = 1 as const

type SimulationSnapshotV1 = {
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
	persistedAt: string
	savedAt: string
	serialized: string
}

export type SavedSimulationStateStorageSummary = {
	records: SavedSimulationStateRecord[]
	warning: string | undefined
}

type SavedSimulationStateCorruptedBackup = {
	backedUpAt: string
	rawValue: string
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
	persistedAt?: string | undefined
	savedAt: string
	serialized: string
}

type SavedSimulationStateStorageSnapshot = {
	hasMalformedStorageValue: boolean
	droppedRecordCount: number
	rawValue: string | null
	records: SavedSimulationStateStorageRecord[]
}

const BIGINT_VALUE_TAG = '$zoltarBigInt'

class SavedSimulationStateError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SavedSimulationStateError'
	}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTaggedBigIntValue(value: unknown): value is Record<typeof BIGINT_VALUE_TAG, string> {
	return isObjectRecord(value) && Object.keys(value).length === 1 && typeof value[BIGINT_VALUE_TAG] === 'string'
}

function getStorage(storage?: Storage) {
	if (storage !== undefined) return storage
	if (typeof window === 'undefined' || window.localStorage === undefined) throw new Error('Local storage is unavailable')
	return window.localStorage
}

function stringifySimulationValue(value: unknown) {
	const serialized = JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? { [BIGINT_VALUE_TAG]: item.toString() } : (item as never)), 2)
	if (serialized === undefined) throw new Error('Saved simulation state could not be serialized')
	return serialized
}

function parseSimulationValue(serialized: string) {
	return JSON.parse(serialized, (_key, value) => {
		if (isTaggedBigIntValue(value)) return BigInt(value[BIGINT_VALUE_TAG])
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
	if (value['persistedAt'] !== undefined && (typeof value['persistedAt'] !== 'string' || value['persistedAt'].trim() === '' || Number.isNaN(Date.parse(value['persistedAt'])))) {
		throw new SavedSimulationStateError('Saved simulation state record is missing a valid persistedAt timestamp')
	}
}

function normalizeSavedStateStorageRecord(record: SavedSimulationStateStorageRecord): SavedSimulationStateStorageRecord {
	return {
		...record,
		persistedAt: record.persistedAt ?? record.savedAt,
	}
}

function parseSavedStateStorageRecords(serialized: string | null): SavedSimulationStateStorageSnapshot {
	if (serialized === null || serialized.trim() === '') return { droppedRecordCount: 0, hasMalformedStorageValue: false, rawValue: serialized, records: [] }
	let parsed: unknown
	try {
		parsed = JSON.parse(serialized)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		return { droppedRecordCount: 0, hasMalformedStorageValue: true, rawValue: serialized, records: [] }
	}
	if (!Array.isArray(parsed)) return { droppedRecordCount: 0, hasMalformedStorageValue: true, rawValue: serialized, records: [] }
	const validRecords: SavedSimulationStateStorageRecord[] = []
	let droppedRecordCount = 0
	for (const item of parsed) {
		try {
			assertSavedStateRecord(item)
			parseSavedSimulationStateEnvelope(item.serialized)
			validRecords.push(normalizeSavedStateStorageRecord(item))
		} catch (error) {
			if (!(error instanceof SavedSimulationStateError)) throw error
			droppedRecordCount += 1
			continue
		}
	}
	return {
		droppedRecordCount,
		hasMalformedStorageValue: false,
		rawValue: serialized,
		records: validRecords,
	}
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
		persistedAt: storageRecord.persistedAt ?? storageRecord.savedAt,
		savedAt: storageRecord.savedAt,
		serialized: storageRecord.serialized,
	}
}

function getSavedSimulationStateStorageSnapshot(storage?: Storage) {
	return parseSavedStateStorageRecords(getStorage(storage).getItem(SAVED_SIMULATION_STATES_STORAGE_KEY))
}

function getSavedSimulationStateStorageWarningFromSnapshot(snapshot: SavedSimulationStateStorageSnapshot) {
	if (snapshot.hasMalformedStorageValue) return 'Saved simulation state storage is corrupted in browser storage.'
	const droppedRecordCount = snapshot.droppedRecordCount
	if (droppedRecordCount === 0) return undefined
	return droppedRecordCount === 1 ? 'Ignored 1 corrupted saved simulation state in browser storage.' : `Ignored ${droppedRecordCount} corrupted saved simulation states in browser storage.`
}

function toSavedSimulationStateStorageSummary(snapshot: SavedSimulationStateStorageSnapshot): SavedSimulationStateStorageSummary {
	return {
		records: snapshot.records.map(toSavedSimulationStateRecord).sort((left, right) => right.persistedAt.localeCompare(left.persistedAt)),
		warning: getSavedSimulationStateStorageWarningFromSnapshot(snapshot),
	}
}

function writeCorruptedSavedStateStorageBackup(rawValue: string, storage?: Storage) {
	const storageReference = getStorage(storage)
	const serializedExistingBackups = storageReference.getItem(SAVED_SIMULATION_STATES_CORRUPTED_BACKUP_STORAGE_KEY)
	let existingBackups: SavedSimulationStateCorruptedBackup[] = []
	if (serializedExistingBackups !== null && serializedExistingBackups.trim() !== '') {
		try {
			const parsed = JSON.parse(serializedExistingBackups)
			if (Array.isArray(parsed)) {
				existingBackups = parsed.filter((item): item is SavedSimulationStateCorruptedBackup => isObjectRecord(item) && typeof item['backedUpAt'] === 'string' && typeof item['rawValue'] === 'string')
			}
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error
			existingBackups = []
		}
	}
	const nextBackups = [
		{
			backedUpAt: new Date().toISOString(),
			rawValue,
		},
		...existingBackups,
	].slice(0, MAX_CORRUPTED_SAVED_STATE_BACKUPS)
	storageReference.setItem(SAVED_SIMULATION_STATES_CORRUPTED_BACKUP_STORAGE_KEY, JSON.stringify(nextBackups))
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

export function getSavedSimulationStateStorageSummary(storage?: Storage) {
	return toSavedSimulationStateStorageSummary(getSavedSimulationStateStorageSnapshot(storage))
}

export function removeCorruptedSavedSimulationStates(storage?: Storage) {
	const storageReference = getStorage(storage)
	const snapshot = getSavedSimulationStateStorageSnapshot(storageReference)
	if (snapshot.hasMalformedStorageValue) {
		if (snapshot.rawValue !== null && snapshot.rawValue.trim() !== '') {
			writeCorruptedSavedStateStorageBackup(snapshot.rawValue, storageReference)
		}
		writeSavedStateStorageRecords([], storageReference)
		return 1
	}
	if (snapshot.droppedRecordCount === 0) return 0
	writeSavedStateStorageRecords(snapshot.records, storageReference)
	return snapshot.droppedRecordCount
}

function getSavedSimulationStateRecord(stateId: string, storage?: Storage) {
	return getSavedSimulationStateStorageSummary(storage).records.find(record => record.id === stateId)
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
	const currentRecords = getSavedSimulationStateStorageSnapshot(storage).records
	const persistedAt = new Date().toISOString()
	const id = createSavedStateRecordId({
		existingIds: new Set(currentRecords.map(record => record.id)),
		name: envelope.name,
		savedAt: envelope.savedAt,
	})
	const nextRecord = {
		baseScenario: envelope.baseScenario,
		id,
		name: envelope.name,
		persistedAt,
		savedAt: envelope.savedAt,
		serialized: normalizedSerialized,
	} satisfies SavedSimulationStateStorageRecord
	writeSavedStateStorageRecords([...currentRecords, nextRecord], storage)
	return toSavedSimulationStateRecord(nextRecord)
}

export function deleteSavedSimulationState(stateId: string, storage?: Storage) {
	const currentRecords = getSavedSimulationStateStorageSnapshot(storage).records
	const nextRecords = currentRecords.filter(record => record.id !== stateId)
	if (nextRecords.length === currentRecords.length) return false
	writeSavedStateStorageRecords(nextRecords, storage)
	return true
}
