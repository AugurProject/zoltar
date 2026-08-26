import { concatHex, encodeAbiParameters, getAddress, keccak256, toHex, zeroAddress, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { canonicalUintString, type CanonicalUintString } from '../core/units.ts'

export const CARRY_MMR_MAXIMUM_PEAKS = 64
export const CARRY_NULLIFIER_DEPTH = 64

const MAXIMUM_CARRY_LEAF_COUNT = 1n << BigInt(CARRY_MMR_MAXIMUM_PEAKS)
const MAXIMUM_UINT256 = (1n << 256n) - 1n
const NULLIFIER_PATH_MASK = (1n << BigInt(CARRY_NULLIFIER_DEPTH)) - 1n
const NULLIFIER_CONSUMED_LEAF = toHex(1n, { size: 32 })
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} must be an object`)
	return value
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string) {
	const actual = Object.keys(record).sort()
	const wanted = [...expected].sort()
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label} has unexpected or missing fields`)
}

function stringField(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key]
	if (typeof value !== 'string') throw new Error(`${label}.${key} must be a string`)
	return value
}

function booleanField(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key]
	if (typeof value !== 'boolean') throw new Error(`${label}.${key} must be a boolean`)
	return value
}

export type CarryOutcome = 0 | 1 | 2
export type CarryTriple<T> = readonly [T, T, T]

export interface CarryLeaf {
	depositor: Address
	outcome: CarryOutcome
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	cumulativeAmountAttoRep: CanonicalUintString
	sourceNodeId: string
}

export interface CarryLeafSlot {
	hash: Hash
	originGame: Address
	leaf: CarryLeaf
	consumedLocally: boolean
}

export interface SparseNullifierEntry {
	parentDepositIndex: string
	/** Decimal encoding of the low 64 bits of keccak256(abi.encode(parentDepositIndex)). */
	path: string
}

export interface SparseNullifierState {
	consumed: SparseNullifierEntry[]
}

export interface CarryOutcomeState {
	/** Immutable inherited baseline checked by withdrawDeposit(CarriedDepositProof,...). */
	snapshotSlots: CarryLeafSlot[]
	/** Descendant-export state: snapshot slots followed by local appends and literal-zero local removals. */
	currentSlots: CarryLeafSlot[]
	nullifier: SparseNullifierState
	/** Exact effective unresolved total returned by getForkCarrySnapshot for this version. */
	unresolvedTotalAttoRep: CanonicalUintString
	/** Exact outcome balance returned by getOutcomeBalancesAttoRep for this version. */
	resolutionBalanceAttoRep: CanonicalUintString
}

export interface CarryGameState {
	outcomes: [CarryOutcomeState, CarryOutcomeState, CarryOutcomeState]
}

export type CarryHistoryMutation =
	| { kind: 'origin' }
	| { kind: 'checkpoint'; snapshotId: Hash; sourceGame: Address; sourceVersionSequence: string }
	| {
			kind: 'accounting-update'
			unresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
			resolutionBalancesAttoRep: CarryTriple<CanonicalUintString>
	  }
	| {
			kind: 'local-append' | 'local-consumption' | 'inherited-consumption'
			outcome: CarryOutcome
			parentDepositIndex: string
			sourceNodeId: string
			resultingUnresolvedTotalAttoRep: CanonicalUintString
	  }

export interface CarryGameVersion {
	/** Contiguous decimal version, beginning at zero. */
	sequence: string
	mutation: CarryHistoryMutation
	state: CarryGameState
}

export interface CarryGameHistory {
	schemaVersion: 1
	game: Address
	pool: Address
	versions: CarryGameVersion[]
}

export interface CarryCheckpoint {
	targetGame: Address
	sourceGame: Address
	snapshotId: Hash
	carryRoots: CarryTriple<Hash>
	nullifierRoots: CarryTriple<Hash>
	leafCounts: CarryTriple<string>
	unresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	resolutionBalancesAttoRep: CarryTriple<CanonicalUintString>
}

export interface MerkleMountainRangeProof {
	/** Offset within the selected peak, not the global MMR slot. */
	leafIndex: string
	/** The Solidity field is named peakIndex, but its value is the selected peak height. */
	merkleMountainRangePeakIndex: string
	/** Intra-peak siblings bottom-up, followed by other peak roots in ascending-height order. */
	merkleMountainRangeSiblings: Hash[]
}

export interface CarriedDepositProof extends MerkleMountainRangeProof {
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	cumulativeAmountAttoRep: CanonicalUintString
	sourceNodeId: string
	nullifierSiblings: Hash[]
}

export interface CarryCommitment {
	leafCount: string
	peaks: Hash[]
	root: Hash
}

export interface CarryConsumption {
	depositor: Address
	outcome: CarryOutcome
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	sourceNodeId: string
	/** Exact resultingUnresolvedTotalAttoRep emitted by CarryDepositConsumed. */
	resultingUnresolvedTotalAttoRep: CanonicalUintString
	expectedCarryRoot?: Hash
	expectedNullifierRoot?: Hash
}

export interface CarryAccounting {
	unresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	resolutionBalancesAttoRep: CarryTriple<CanonicalUintString>
}

export interface CarryConsumptionResult {
	history: CarryGameHistory
	kind: 'local' | 'inherited'
}

export interface AuthenticatedCarryConsumption extends CarryConsumption {
	expectedCarryRoot: Hash
	expectedNullifierRoot: Hash
}

/**
 * Deterministic operation counters for the compact replay path. They are also
 * useful in tests: streaming mutations must never materialize or clone a
 * growing CarryGameState.
 */
export interface CarryProofAccumulatorInstrumentation {
	accumulatorBuildSlotVisits: number
	fullStateMaterializations: number
	materializedSlotVisits: number
	mmrHashOperations: number
	nullifierHashOperations: number
	proofNodeReads: number
	streamingMutationCount: number
}

interface IndexedMerkleMountainRange {
	leafCount: number
	nodes: Map<string, Hash>
	peaks: Array<Hash | undefined>
}

interface IndexedSparseNullifier {
	consumedByParent: Map<string, SparseNullifierEntry>
	nodes: Map<string, Hash>
	ownerByPath: Map<string, string>
}

interface CarryOutcomeAccumulator {
	currentMmr: IndexedMerkleMountainRange
	currentSlotIndexByIdentity: Map<string, number>
	currentSlotIndexByParent: Map<string, number>
	nullifier: IndexedSparseNullifier
	snapshotMmr: IndexedMerkleMountainRange
	snapshotSlotIndexesByParent: Map<string, number[]>
}

/** Ephemeral replay index. Only CarryGameState returned by materialization is durable data. */
export interface CarryProofAccumulator {
	readonly game: Address
	readonly instrumentation: CarryProofAccumulatorInstrumentation
	readonly pool: Address
	/** @internal Mutable state owned exclusively by accumulator helpers in this module. */
	readonly state: CarryGameState
	/** @internal Ephemeral indexes owned exclusively by accumulator helpers in this module. */
	readonly outcomes: [CarryOutcomeAccumulator, CarryOutcomeAccumulator, CarryOutcomeAccumulator]
}

function unsignedInteger(value: string, label: string) {
	if (!UNSIGNED_INTEGER_PATTERN.test(value)) throw new Error(`${label} must be an unsigned decimal integer`)
	const parsed = BigInt(value)
	if (parsed > MAXIMUM_UINT256) throw new Error(`${label} exceeds uint256`)
	return parsed
}

function requireHash(value: string, label: string) {
	if (!HASH_PATTERN.test(value)) throw new Error(`${label} must be a 32-byte hash`)
}

function requireOutcome(value: number, label = 'Carry outcome'): asserts value is CarryOutcome {
	if (value !== 0 && value !== 1 && value !== 2) throw new Error(`${label} must be Invalid, Yes, or No`)
}

function requireLeaf(leaf: CarryLeaf, label = 'Carry leaf') {
	requireOutcome(leaf.outcome, `${label} outcome`)
	getAddress(leaf.depositor)
	const amountAttoRep = unsignedInteger(leaf.amountAttoRep, `${label} amountAttoRep`)
	const cumulativeAmountAttoRep = unsignedInteger(leaf.cumulativeAmountAttoRep, `${label} cumulativeAmountAttoRep`)
	unsignedInteger(leaf.parentDepositIndex, `${label} parentDepositIndex`)
	const sourceNodeId = unsignedInteger(leaf.sourceNodeId, `${label} sourceNodeId`)
	if (amountAttoRep === 0n) throw new Error(`${label} amountAttoRep must be positive`)
	if (cumulativeAmountAttoRep < amountAttoRep) throw new Error(`${label} cumulativeAmountAttoRep is below its amount`)
	if (sourceNodeId === 0n) throw new Error(`${label} sourceNodeId must be positive`)
}

function cloneLeaf(leaf: CarryLeaf): CarryLeaf {
	return { ...leaf }
}

function cloneSlot(slot: CarryLeafSlot): CarryLeafSlot {
	return { ...slot, leaf: cloneLeaf(slot.leaf) }
}

function cloneNullifier(state: SparseNullifierState): SparseNullifierState {
	return { consumed: state.consumed.map(entry => ({ ...entry })) }
}

function cloneOutcomeState(state: CarryOutcomeState): CarryOutcomeState {
	return {
		currentSlots: state.currentSlots.map(cloneSlot),
		nullifier: cloneNullifier(state.nullifier),
		resolutionBalanceAttoRep: state.resolutionBalanceAttoRep,
		snapshotSlots: state.snapshotSlots.map(cloneSlot),
		unresolvedTotalAttoRep: state.unresolvedTotalAttoRep,
	}
}

export function cloneCarryGameState(state: CarryGameState): CarryGameState {
	return {
		outcomes: [cloneOutcomeState(state.outcomes[0]), cloneOutcomeState(state.outcomes[1]), cloneOutcomeState(state.outcomes[2])],
	}
}

function parseCarryLeaf(value: unknown, label: string): CarryLeaf {
	const record = requiredRecord(value, label)
	exactKeys(record, ['amountAttoRep', 'cumulativeAmountAttoRep', 'depositor', 'outcome', 'parentDepositIndex', 'sourceNodeId'], label)
	const outcome = record['outcome']
	if (outcome !== 0 && outcome !== 1 && outcome !== 2) throw new Error(`${label}.outcome must be Invalid, Yes, or No`)
	const leaf: CarryLeaf = {
		amountAttoRep: stringField(record, 'amountAttoRep', label),
		cumulativeAmountAttoRep: stringField(record, 'cumulativeAmountAttoRep', label),
		depositor: getAddress(stringField(record, 'depositor', label)),
		outcome,
		parentDepositIndex: stringField(record, 'parentDepositIndex', label),
		sourceNodeId: stringField(record, 'sourceNodeId', label),
	}
	requireLeaf(leaf, label)
	return leaf
}

function parseCarryLeafSlot(value: unknown, label: string): CarryLeafSlot {
	const record = requiredRecord(value, label)
	exactKeys(record, ['consumedLocally', 'hash', 'leaf', 'originGame'], label)
	const slotHash = stringField(record, 'hash', label)
	requireHash(slotHash, `${label}.hash`)
	const slot: CarryLeafSlot = {
		consumedLocally: booleanField(record, 'consumedLocally', label),
		hash: toHex(BigInt(slotHash), { size: 32 }),
		leaf: parseCarryLeaf(record['leaf'], `${label}.leaf`),
		originGame: getAddress(stringField(record, 'originGame', label)),
	}
	return slot
}

function parseCarryOutcomeState(value: unknown, label: string): CarryOutcomeState {
	const record = requiredRecord(value, label)
	exactKeys(record, ['currentSlots', 'nullifier', 'resolutionBalanceAttoRep', 'snapshotSlots', 'unresolvedTotalAttoRep'], label)
	const currentSlots = record['currentSlots']
	const snapshotSlots = record['snapshotSlots']
	if (!Array.isArray(currentSlots)) throw new Error(`${label}.currentSlots must be an array`)
	if (!Array.isArray(snapshotSlots)) throw new Error(`${label}.snapshotSlots must be an array`)
	const nullifier = requiredRecord(record['nullifier'], `${label}.nullifier`)
	exactKeys(nullifier, ['consumed'], `${label}.nullifier`)
	const consumed = nullifier['consumed']
	if (!Array.isArray(consumed)) throw new Error(`${label}.nullifier.consumed must be an array`)
	const state: CarryOutcomeState = {
		currentSlots: currentSlots.map((slot, index) => parseCarryLeafSlot(slot, `${label}.currentSlots[${index.toString()}]`)),
		nullifier: {
			consumed: consumed.map((entry, index) => {
				const entryLabel = `${label}.nullifier.consumed[${index.toString()}]`
				const entryRecord = requiredRecord(entry, entryLabel)
				exactKeys(entryRecord, ['parentDepositIndex', 'path'], entryLabel)
				return {
					parentDepositIndex: stringField(entryRecord, 'parentDepositIndex', entryLabel),
					path: stringField(entryRecord, 'path', entryLabel),
				}
			}),
		},
		resolutionBalanceAttoRep: stringField(record, 'resolutionBalanceAttoRep', label),
		snapshotSlots: snapshotSlots.map((slot, index) => parseCarryLeafSlot(slot, `${label}.snapshotSlots[${index.toString()}]`)),
		unresolvedTotalAttoRep: stringField(record, 'unresolvedTotalAttoRep', label),
	}
	unsignedInteger(state.resolutionBalanceAttoRep, `${label}.resolutionBalanceAttoRep`)
	unsignedInteger(state.unresolvedTotalAttoRep, `${label}.unresolvedTotalAttoRep`)
	return state
}

/** Strict durable-schema parser used by authenticated carry-journal checkpoints. */
export function parseCarryGameState(value: unknown, label = 'Carry game state'): CarryGameState {
	const record = requiredRecord(value, label)
	exactKeys(record, ['outcomes'], label)
	const outcomes = record['outcomes']
	if (!Array.isArray(outcomes) || outcomes.length !== 3) throw new Error(`${label}.outcomes must contain exactly three outcomes`)
	const state: CarryGameState = {
		outcomes: [parseCarryOutcomeState(outcomes[0], `${label}.outcomes[0]`), parseCarryOutcomeState(outcomes[1], `${label}.outcomes[1]`), parseCarryOutcomeState(outcomes[2], `${label}.outcomes[2]`)],
	}
	for (const outcome of [0, 1, 2] as const) {
		for (const [index, slot] of [...state.outcomes[outcome].snapshotSlots, ...state.outcomes[outcome].currentSlots].entries()) {
			if (slot.leaf.outcome !== outcome) throw new Error(`${label}.outcomes[${outcome.toString()}] slot ${index.toString()} carries a different outcome`)
		}
	}
	const validated = createCarryProofAccumulator(zeroAddress, zeroAddress, state)
	return materializeCarryProofAccumulatorState(validated)
}

function emptyOutcomeState(): CarryOutcomeState {
	return {
		currentSlots: [],
		nullifier: { consumed: [] },
		resolutionBalanceAttoRep: canonicalUintString(0n),
		snapshotSlots: [],
		unresolvedTotalAttoRep: canonicalUintString(0n),
	}
}

export function emptyCarryGameState(): CarryGameState {
	return { outcomes: [emptyOutcomeState(), emptyOutcomeState(), emptyOutcomeState()] }
}

export function hashCarryParent(left: Hash, right: Hash): Hash {
	requireHash(left, 'Left carry hash')
	requireHash(right, 'Right carry hash')
	return keccak256(concatHex([left, right]))
}

export function hashCarryLeaf(leaf: CarryLeaf): Hash {
	requireLeaf(leaf)
	return keccak256(
		encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [leaf.depositor, leaf.outcome, BigInt(leaf.amountAttoRep), BigInt(leaf.parentDepositIndex), BigInt(leaf.cumulativeAmountAttoRep), BigInt(leaf.sourceNodeId)]),
	)
}

function requireSlots(slots: readonly CarryLeafSlot[], label: string) {
	if (BigInt(slots.length) >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error(`${label} exceeds the 64-peak MMR capacity`)
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index]
		if (slot === undefined) throw new Error(`${label} has a missing slot at ${index.toString()}`)
		requireHash(slot.hash, `${label}[${index.toString()}].hash`)
		getAddress(slot.originGame)
		requireLeaf(slot.leaf, `${label}[${index.toString()}].leaf`)
		const expectedHash = hashCarryLeaf(slot.leaf)
		if (slot.consumedLocally) {
			if (slot.hash !== zeroHash) throw new Error(`${label}[${index.toString()}] locally consumed slot is not the literal zero hash`)
		} else if (slot.hash.toLowerCase() !== expectedHash.toLowerCase()) {
			throw new Error(`${label}[${index.toString()}] hash does not match its carry leaf`)
		}
	}
}

function occupiedPeakCount(leafCount: bigint) {
	let count = 0
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 1n) count += 1
	}
	return count
}

function computedPeaks(hashes: readonly Hash[]) {
	if (BigInt(hashes.length) >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry hashes exceed the 64-peak MMR capacity')
	const peaks: Array<Hash | undefined> = Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => undefined)
	let leafCount = 0n
	for (const hash of hashes) {
		requireHash(hash, 'Carry leaf slot hash')
		let node = hash
		let height = 0
		while (((leafCount >> BigInt(height)) & 1n) === 1n) {
			const left = peaks[height]
			if (left === undefined) throw new Error(`Carry MMR peak ${height.toString()} is missing during append`)
			node = hashCarryParent(left, node)
			peaks[height] = undefined
			height += 1
		}
		if (height >= CARRY_MMR_MAXIMUM_PEAKS) throw new Error('Carry MMR is too tall')
		peaks[height] = node
		leafCount += 1n
	}
	return peaks
}

function bagComputedPeaks(peaks: readonly (Hash | undefined)[], leafCount: bigint): Hash {
	if (leafCount === 0n) return zeroHash
	const occupied: Hash[] = []
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const peak = peaks[height]
		if (peak === undefined) throw new Error(`Occupied carry peak ${height.toString()} is missing`)
		occupied.push(peak)
	}
	const last = occupied.at(-1)
	if (last === undefined) throw new Error('Nonempty carry MMR has no occupied peak')
	let root = last
	for (let index = occupied.length - 2; index >= 0; index -= 1) {
		const peak = occupied[index]
		if (peak === undefined) throw new Error(`Carry peak ${index.toString()} is missing during bagging`)
		root = hashCarryParent(peak, root)
	}
	return root
}

export function carryCommitment(slots: readonly CarryLeafSlot[]): CarryCommitment {
	requireSlots(slots, 'Carry slots')
	const leafCount = BigInt(slots.length)
	const peaks = computedPeaks(slots.map(slot => slot.hash))
	return {
		leafCount: leafCount.toString(),
		peaks: peaks.map(peak => peak ?? zeroHash),
		root: bagComputedPeaks(peaks, leafCount),
	}
}

function peakForGlobalLeaf(leafCount: bigint, globalLeafIndex: bigint) {
	if (leafCount <= 0n || globalLeafIndex < 0n || globalLeafIndex >= leafCount) throw new Error('Carry global leaf index is outside the MMR')
	let peakStartIndex = 0n
	for (let height = CARRY_MMR_MAXIMUM_PEAKS - 1; height >= 0; height -= 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const nextPeakStartIndex = peakStartIndex + (1n << BigInt(height))
		if (globalLeafIndex < nextPeakStartIndex) {
			return { height, peakStartIndex, relativeLeafIndex: globalLeafIndex - peakStartIndex }
		}
		peakStartIndex = nextPeakStartIndex
	}
	throw new Error('Carry leaf has no occupied MMR peak')
}

function merkleRoot(hashes: readonly Hash[]) {
	if (hashes.length === 0 || (hashes.length & (hashes.length - 1)) !== 0) throw new Error('Merkle peak must contain a positive power-of-two number of leaves')
	let level = [...hashes]
	while (level.length > 1) {
		const next: Hash[] = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = level[index + 1]
			if (left === undefined || right === undefined) throw new Error('Merkle peak contains an incomplete pair')
			next.push(hashCarryParent(left, right))
		}
		level = next
	}
	const root = level[0]
	if (root === undefined) throw new Error('Merkle peak root is missing')
	return root
}

export function createMerkleMountainRangeProof(hashes: readonly Hash[], globalLeafIndex: number): MerkleMountainRangeProof {
	if (!Number.isSafeInteger(globalLeafIndex) || globalLeafIndex < 0 || globalLeafIndex >= hashes.length) throw new Error('Carry proof global leaf index is outside the MMR')
	const leafCount = BigInt(hashes.length)
	if (leafCount >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry hashes exceed the 64-peak MMR capacity')
	const selected = peakForGlobalLeaf(leafCount, BigInt(globalLeafIndex))
	const peakSize = Number(1n << BigInt(selected.height))
	if (!Number.isSafeInteger(peakSize)) throw new Error('Carry proof peak cannot be represented by an in-memory JavaScript array')
	const peakStart = Number(selected.peakStartIndex)
	let indexWithinLevel = Number(selected.relativeLeafIndex)
	let level = hashes.slice(peakStart, peakStart + peakSize)
	const siblings: Hash[] = []
	for (let height = 0; height < selected.height; height += 1) {
		const sibling = level[indexWithinLevel ^ 1]
		if (sibling === undefined) throw new Error(`Carry proof sibling is missing at height ${height.toString()}`)
		siblings.push(sibling)
		const next: Hash[] = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = level[index + 1]
			if (left === undefined || right === undefined) throw new Error('Carry proof peak contains an incomplete pair')
			next.push(hashCarryParent(left, right))
		}
		level = next
		indexWithinLevel = Math.floor(indexWithinLevel / 2)
	}

	let otherPeakStart = 0
	const otherPeaks = new Map<number, Hash>()
	for (let height = CARRY_MMR_MAXIMUM_PEAKS - 1; height >= 0; height -= 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const size = Number(1n << BigInt(height))
		if (!Number.isSafeInteger(size)) throw new Error('Carry proof peak cannot be represented by an in-memory JavaScript array')
		if (height !== selected.height) otherPeaks.set(height, merkleRoot(hashes.slice(otherPeakStart, otherPeakStart + size)))
		otherPeakStart += size
	}
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n || height === selected.height) continue
		const peak = otherPeaks.get(height)
		if (peak === undefined) throw new Error(`Other carry peak ${height.toString()} is missing`)
		siblings.push(peak)
	}
	return {
		leafIndex: selected.relativeLeafIndex.toString(),
		merkleMountainRangePeakIndex: selected.height.toString(),
		merkleMountainRangeSiblings: siblings,
	}
}

export function computeMerkleMountainRangeRootFromProof(leafHash: Hash, leafCountValue: string, proof: MerkleMountainRangeProof): Hash {
	requireHash(leafHash, 'Carry proof leaf hash')
	const leafCount = unsignedInteger(leafCountValue, 'Carry proof leaf count')
	if (leafCount === 0n || leafCount >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry proof leaf count is outside the MMR capacity')
	const peakHeight = unsignedInteger(proof.merkleMountainRangePeakIndex, 'Carry proof peak height')
	if (peakHeight >= BigInt(CARRY_MMR_MAXIMUM_PEAKS)) throw new Error('Carry proof peak height is too high')
	if (((leafCount >> peakHeight) & 1n) !== 1n) throw new Error('Carry proof selected peak is absent')
	const leafIndex = unsignedInteger(proof.leafIndex, 'Carry proof leaf index')
	if (leafIndex >= 1n << peakHeight) throw new Error('Carry proof leaf index is outside its peak')
	const peakCount = occupiedPeakCount(leafCount)
	const expectedLength = Number(peakHeight) + peakCount - 1
	if (proof.merkleMountainRangeSiblings.length !== expectedLength) throw new Error(`Carry proof has ${proof.merkleMountainRangeSiblings.length.toString()} siblings instead of ${expectedLength.toString()}`)
	for (const sibling of proof.merkleMountainRangeSiblings) requireHash(sibling, 'Carry proof sibling')

	let peakRoot = leafHash
	for (let level = 0; level < Number(peakHeight); level += 1) {
		const sibling = proof.merkleMountainRangeSiblings[level]
		if (sibling === undefined) throw new Error(`Carry proof path sibling ${level.toString()} is missing`)
		peakRoot = ((leafIndex >> BigInt(level)) & 1n) === 0n ? hashCarryParent(peakRoot, sibling) : hashCarryParent(sibling, peakRoot)
	}
	const peaks: Hash[] = []
	let siblingIndex = Number(peakHeight)
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		if (BigInt(height) === peakHeight) peaks.push(peakRoot)
		else {
			const siblingPeak = proof.merkleMountainRangeSiblings[siblingIndex]
			if (siblingPeak === undefined) throw new Error(`Carry proof other peak ${height.toString()} is missing`)
			peaks.push(siblingPeak)
			siblingIndex += 1
		}
	}
	let root = peaks.at(-1)
	if (root === undefined) throw new Error('Carry proof contains no peaks')
	for (let index = peaks.length - 2; index >= 0; index -= 1) {
		const peak = peaks[index]
		if (peak === undefined) throw new Error(`Carry proof peak ${index.toString()} is missing`)
		root = hashCarryParent(peak, root)
	}
	return root
}

export function verifyMerkleMountainRangeProof(leafHash: Hash, leafCount: string, expectedRoot: Hash, proof: MerkleMountainRangeProof) {
	requireHash(expectedRoot, 'Expected carry root')
	const actualRoot = computeMerkleMountainRangeRootFromProof(leafHash, leafCount, proof)
	if (actualRoot.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error(`Carry proof root ${actualRoot} does not match ${expectedRoot}`)
	return actualRoot
}

function buildZeroHashes() {
	const hashes: Hash[] = [zeroHash]
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const current = hashes[depth]
		if (current === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
		hashes.push(hashCarryParent(current, current))
	}
	return hashes
}

const NULLIFIER_ZERO_HASHES = buildZeroHashes()

export function nullifierPath(parentDepositIndex: string) {
	const value = unsignedInteger(parentDepositIndex, 'Nullifier parentDepositIndex')
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [value]))) & NULLIFIER_PATH_MASK
}

export function assertNoNullifierPathCollisions(entries: readonly SparseNullifierEntry[]) {
	const ownerByPath = new Map<string, string>()
	for (const entry of entries) {
		unsignedInteger(entry.parentDepositIndex, 'Nullifier entry parentDepositIndex')
		const path = unsignedInteger(entry.path, 'Nullifier entry path')
		if (path > NULLIFIER_PATH_MASK) throw new Error('Nullifier entry path exceeds 64 bits')
		const previous = ownerByPath.get(entry.path)
		if (previous !== undefined && previous !== entry.parentDepositIndex) {
			throw new Error(`Nullifier path collision between parent deposits ${previous} and ${entry.parentDepositIndex}`)
		}
		ownerByPath.set(entry.path, entry.parentDepositIndex)
	}
}

export function validateSparseNullifierState(state: SparseNullifierState) {
	assertNoNullifierPathCollisions(state.consumed)
	const parents = new Set<string>()
	let previous: bigint | undefined
	for (const entry of state.consumed) {
		const parent = unsignedInteger(entry.parentDepositIndex, 'Nullifier entry parentDepositIndex')
		if (parents.has(entry.parentDepositIndex)) throw new Error(`Nullifier parent deposit ${entry.parentDepositIndex} is duplicated`)
		parents.add(entry.parentDepositIndex)
		if (previous !== undefined && parent <= previous) throw new Error('Nullifier entries are not in canonical parent-deposit order')
		previous = parent
		const expectedPath = nullifierPath(entry.parentDepositIndex).toString()
		if (entry.path !== expectedPath) throw new Error(`Nullifier path for parent deposit ${entry.parentDepositIndex} is invalid`)
	}
}

export function emptySparseNullifierState(): SparseNullifierState {
	return { consumed: [] }
}

function sparseNullifierNodes(state: SparseNullifierState) {
	validateSparseNullifierState(state)
	const nodes = new Map<string, Hash>()
	for (const entry of state.consumed) {
		let nodeIndex = BigInt(entry.path)
		let nodeHash = NULLIFIER_CONSUMED_LEAF
		nodes.set(`0:${nodeIndex.toString()}`, nodeHash)
		for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
			const siblingIndex = nodeIndex ^ 1n
			const zero = NULLIFIER_ZERO_HASHES[depth]
			if (zero === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
			const siblingHash = nodes.get(`${depth.toString()}:${siblingIndex.toString()}`) ?? zero
			nodeHash = (nodeIndex & 1n) === 0n ? hashCarryParent(nodeHash, siblingHash) : hashCarryParent(siblingHash, nodeHash)
			nodeIndex >>= 1n
			nodes.set(`${(depth + 1).toString()}:${nodeIndex.toString()}`, nodeHash)
		}
	}
	return nodes
}

export function sparseNullifierRoot(state: SparseNullifierState) {
	const nodes = sparseNullifierNodes(state)
	const emptyRoot = NULLIFIER_ZERO_HASHES[CARRY_NULLIFIER_DEPTH]
	if (emptyRoot === undefined) throw new Error('Empty nullifier root is missing')
	return nodes.get(`${CARRY_NULLIFIER_DEPTH.toString()}:0`) ?? emptyRoot
}

export function createSparseNullifierProof(state: SparseNullifierState, parentDepositIndex: string) {
	const nodes = sparseNullifierNodes(state)
	let nodeIndex = nullifierPath(parentDepositIndex)
	const siblings: Hash[] = []
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const zero = NULLIFIER_ZERO_HASHES[depth]
		if (zero === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
		siblings.push(nodes.get(`${depth.toString()}:${(nodeIndex ^ 1n).toString()}`) ?? zero)
		nodeIndex >>= 1n
	}
	return siblings
}

export function computeNullifierRootFromProof(parentDepositIndex: string, siblings: readonly Hash[], leafValue: Hash) {
	if (siblings.length !== CARRY_NULLIFIER_DEPTH) throw new Error(`Nullifier proof has ${siblings.length.toString()} siblings instead of ${CARRY_NULLIFIER_DEPTH.toString()}`)
	requireHash(leafValue, 'Nullifier leaf value')
	let path = nullifierPath(parentDepositIndex)
	let root = leafValue
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const sibling = siblings[depth]
		if (sibling === undefined) throw new Error(`Nullifier sibling ${depth.toString()} is missing`)
		requireHash(sibling, `Nullifier sibling ${depth.toString()}`)
		root = (path & 1n) === 0n ? hashCarryParent(root, sibling) : hashCarryParent(sibling, root)
		path >>= 1n
	}
	return root
}

export function verifySparseNullifierAbsence(state: SparseNullifierState, parentDepositIndex: string, siblings: readonly Hash[]) {
	const rootFromProof = computeNullifierRootFromProof(parentDepositIndex, siblings, zeroHash)
	const expectedRoot = sparseNullifierRoot(state)
	if (rootFromProof.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error(`Nullifier proof root ${rootFromProof} does not match ${expectedRoot}`)
	return rootFromProof
}

export function consumeSparseNullifier(state: SparseNullifierState, parentDepositIndex: string): SparseNullifierState {
	validateSparseNullifierState(state)
	if (state.consumed.some(entry => entry.parentDepositIndex === parentDepositIndex)) throw new Error(`Parent deposit ${parentDepositIndex} is already nullified`)
	const entry = { parentDepositIndex, path: nullifierPath(parentDepositIndex).toString() }
	assertNoNullifierPathCollisions([...state.consumed, entry])
	const consumed = [...state.consumed.map(value => ({ ...value })), entry].sort((left, right) => {
		const leftParent = BigInt(left.parentDepositIndex)
		const rightParent = BigInt(right.parentDepositIndex)
		if (leftParent < rightParent) return -1
		if (leftParent > rightParent) return 1
		return 0
	})
	const next = { consumed }
	validateSparseNullifierState(next)
	return next
}

function currentVersion(history: CarryGameHistory) {
	const version = history.versions.at(-1)
	if (version === undefined) throw new Error(`Carry history ${history.game} has no versions`)
	return version
}

export function currentCarryGameState(history: CarryGameHistory) {
	return cloneCarryGameState(currentVersion(history).state)
}

function validateCarryAccounting(accounting: CarryAccounting, label: string) {
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		unsignedInteger(accounting.unresolvedTotalsAttoRep[outcome], `${label} unresolved total ${outcome.toString()}`)
		unsignedInteger(accounting.resolutionBalancesAttoRep[outcome], `${label} resolution balance ${outcome.toString()}`)
	}
}

export function carryGameAccounting(state: CarryGameState): CarryAccounting {
	const unresolvedTotalsAttoRep: CarryTriple<CanonicalUintString> = [state.outcomes[0].unresolvedTotalAttoRep, state.outcomes[1].unresolvedTotalAttoRep, state.outcomes[2].unresolvedTotalAttoRep]
	const resolutionBalancesAttoRep: CarryTriple<CanonicalUintString> = [state.outcomes[0].resolutionBalanceAttoRep, state.outcomes[1].resolutionBalanceAttoRep, state.outcomes[2].resolutionBalanceAttoRep]
	const accounting = { resolutionBalancesAttoRep, unresolvedTotalsAttoRep }
	validateCarryAccounting(accounting, 'Carry state')
	return accounting
}

function cloneHistoryMutation(mutation: CarryHistoryMutation): CarryHistoryMutation {
	if (mutation.kind !== 'accounting-update') return { ...mutation }
	return {
		kind: mutation.kind,
		resolutionBalancesAttoRep: [mutation.resolutionBalancesAttoRep[0], mutation.resolutionBalancesAttoRep[1], mutation.resolutionBalancesAttoRep[2]],
		unresolvedTotalsAttoRep: [mutation.unresolvedTotalsAttoRep[0], mutation.unresolvedTotalsAttoRep[1], mutation.unresolvedTotalsAttoRep[2]],
	}
}

function appendVersion(history: CarryGameHistory, state: CarryGameState, mutation: CarryHistoryMutation): CarryGameHistory {
	const sequence = history.versions.length.toString()
	return {
		...history,
		versions: [...history.versions, { mutation: cloneHistoryMutation(mutation), sequence, state: cloneCarryGameState(state) }],
	}
}

export function createCarryGameHistory(game: Address, pool: Address): CarryGameHistory {
	return {
		game: getAddress(game),
		pool: getAddress(pool),
		schemaVersion: 1,
		versions: [{ mutation: { kind: 'origin' }, sequence: '0', state: emptyCarryGameState() }],
	}
}

/**
 * Records an exact onchain accounting observation without changing proof commitments.
 * This covers non-leaf changes such as inherited claim retention and truth-auction haircuts.
 */
export function setCarryGameAccounting(history: CarryGameHistory, accounting: CarryAccounting): CarryGameHistory {
	validateCarryAccounting(accounting, 'Carry accounting update')
	const state = currentCarryGameState(history)
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		state.outcomes[outcome].unresolvedTotalAttoRep = accounting.unresolvedTotalsAttoRep[outcome]
		state.outcomes[outcome].resolutionBalanceAttoRep = accounting.resolutionBalancesAttoRep[outcome]
	}
	return appendVersion(history, state, {
		kind: 'accounting-update',
		resolutionBalancesAttoRep: [...accounting.resolutionBalancesAttoRep],
		unresolvedTotalsAttoRep: [...accounting.unresolvedTotalsAttoRep],
	})
}

export function appendLocalCarryLeaf(history: CarryGameHistory, leaf: CarryLeaf): CarryGameHistory {
	requireLeaf(leaf)
	const state = currentCarryGameState(history)
	const outcomeState = state.outcomes[leaf.outcome]
	if (outcomeState.currentSlots.some(slot => slot.leaf.parentDepositIndex === leaf.parentDepositIndex)) {
		throw new Error(`Carry parent deposit ${leaf.parentDepositIndex} already exists for outcome ${leaf.outcome.toString()}`)
	}
	const slot: CarryLeafSlot = {
		consumedLocally: false,
		hash: hashCarryLeaf(leaf),
		leaf: cloneLeaf(leaf),
		originGame: history.game,
	}
	const amountAttoRep = BigInt(leaf.amountAttoRep)
	const expectedCumulativeAmountAttoRep = BigInt(outcomeState.resolutionBalanceAttoRep) + amountAttoRep
	if (BigInt(leaf.cumulativeAmountAttoRep) !== expectedCumulativeAmountAttoRep) {
		throw new Error(`Carry leaf cumulative amount ${leaf.cumulativeAmountAttoRep} does not follow resolution balance ${outcomeState.resolutionBalanceAttoRep}`)
	}
	outcomeState.currentSlots.push(slot)
	outcomeState.unresolvedTotalAttoRep = (BigInt(outcomeState.unresolvedTotalAttoRep) + amountAttoRep).toString()
	outcomeState.resolutionBalanceAttoRep = leaf.cumulativeAmountAttoRep
	return appendVersion(history, state, {
		kind: 'local-append',
		outcome: leaf.outcome,
		parentDepositIndex: leaf.parentDepositIndex,
		resultingUnresolvedTotalAttoRep: outcomeState.unresolvedTotalAttoRep,
		sourceNodeId: leaf.sourceNodeId,
	})
}

function sameLeafIdentity(slot: CarryLeafSlot, consumption: CarryConsumption) {
	return slot.leaf.outcome === consumption.outcome && slot.leaf.parentDepositIndex === consumption.parentDepositIndex && slot.leaf.sourceNodeId === consumption.sourceNodeId && slot.leaf.depositor.toLowerCase() === consumption.depositor.toLowerCase() && slot.leaf.amountAttoRep === consumption.amountAttoRep
}

export function applyCarryConsumption(history: CarryGameHistory, consumption: CarryConsumption): CarryConsumptionResult {
	requireOutcome(consumption.outcome)
	getAddress(consumption.depositor)
	unsignedInteger(consumption.amountAttoRep, 'Carry consumption amountAttoRep')
	unsignedInteger(consumption.parentDepositIndex, 'Carry consumption parentDepositIndex')
	unsignedInteger(consumption.sourceNodeId, 'Carry consumption sourceNodeId')
	const resultingUnresolvedTotalAttoRep = unsignedInteger(consumption.resultingUnresolvedTotalAttoRep, 'Carry consumption resultingUnresolvedTotalAttoRep')
	const state = currentCarryGameState(history)
	const outcomeState = state.outcomes[consumption.outcome]
	const previousUnresolvedTotalAttoRep = BigInt(outcomeState.unresolvedTotalAttoRep)
	if (resultingUnresolvedTotalAttoRep > previousUnresolvedTotalAttoRep) {
		throw new Error('Carry consumption resulting unresolved total increased')
	}
	const matchingIndexes = outcomeState.currentSlots.flatMap((slot, index) => (sameLeafIdentity(slot, consumption) ? [index] : []))
	if (matchingIndexes.length !== 1) throw new Error(`Carry consumption matched ${matchingIndexes.length.toString()} leaves instead of one`)
	const slotIndex = matchingIndexes[0]
	if (slotIndex === undefined) throw new Error('Carry consumption leaf index is missing')
	const slot = outcomeState.currentSlots[slotIndex]
	if (slot === undefined) throw new Error('Carry consumption slot is missing')
	let kind: CarryConsumptionResult['kind']
	if (slot.originGame.toLowerCase() === history.game.toLowerCase()) {
		if (slotIndex < outcomeState.snapshotSlots.length) throw new Error('Carry history marks a target-local leaf as inherited')
		if (slot.consumedLocally) throw new Error(`Local carry deposit ${consumption.parentDepositIndex} is already consumed`)
		const amountAttoRep = BigInt(consumption.amountAttoRep)
		if (amountAttoRep > previousUnresolvedTotalAttoRep || previousUnresolvedTotalAttoRep - amountAttoRep !== resultingUnresolvedTotalAttoRep) {
			throw new Error('Local carry consumption resulting unresolved total is inconsistent')
		}
		outcomeState.currentSlots[slotIndex] = { ...cloneSlot(slot), consumedLocally: true, hash: zeroHash }
		kind = 'local'
	} else {
		if (slotIndex >= outcomeState.snapshotSlots.length) throw new Error('Carry history marks an inherited leaf as target-local')
		if (slot.consumedLocally || slot.hash === zeroHash) throw new Error('A locally consumed source leaf cannot be consumed as an inherited proof')
		outcomeState.nullifier = consumeSparseNullifier(outcomeState.nullifier, consumption.parentDepositIndex)
		kind = 'inherited'
	}
	outcomeState.unresolvedTotalAttoRep = consumption.resultingUnresolvedTotalAttoRep
	const carryRoot = carryCommitment(outcomeState.currentSlots).root
	const nullifierRoot = sparseNullifierRoot(outcomeState.nullifier)
	if (consumption.expectedCarryRoot !== undefined && carryRoot.toLowerCase() !== consumption.expectedCarryRoot.toLowerCase()) {
		throw new Error(`Carry consumption root ${carryRoot} does not match event root ${consumption.expectedCarryRoot}`)
	}
	if (consumption.expectedNullifierRoot !== undefined && nullifierRoot.toLowerCase() !== consumption.expectedNullifierRoot.toLowerCase()) {
		throw new Error(`Carry consumption nullifier ${nullifierRoot} does not match event root ${consumption.expectedNullifierRoot}`)
	}
	return {
		history: appendVersion(history, state, {
			kind: kind === 'local' ? 'local-consumption' : 'inherited-consumption',
			outcome: consumption.outcome,
			parentDepositIndex: consumption.parentDepositIndex,
			resultingUnresolvedTotalAttoRep: consumption.resultingUnresolvedTotalAttoRep,
			sourceNodeId: consumption.sourceNodeId,
		}),
		kind,
	}
}

function checkpointLeafCount(checkpoint: CarryCheckpoint, outcome: CarryOutcome) {
	const value = checkpoint.leafCounts[outcome]
	const leafCount = unsignedInteger(value, `Checkpoint outcome ${outcome.toString()} leaf count`)
	if (leafCount >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error(`Checkpoint outcome ${outcome.toString()} leaf count is too high`)
	return leafCount
}

function bigIntTriple(values: CarryTriple<string>): [bigint, bigint, bigint] {
	return [BigInt(values[0]), BigInt(values[1]), BigInt(values[2])]
}

export function carryCheckpointSnapshotId(checkpoint: Pick<CarryCheckpoint, 'carryRoots' | 'leafCounts' | 'nullifierRoots' | 'resolutionBalancesAttoRep' | 'sourceGame' | 'unresolvedTotalsAttoRep'>) {
	getAddress(checkpoint.sourceGame)
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		requireHash(checkpoint.carryRoots[outcome], `Checkpoint carry root ${outcome.toString()}`)
		requireHash(checkpoint.nullifierRoots[outcome], `Checkpoint nullifier root ${outcome.toString()}`)
		const leafCount = unsignedInteger(checkpoint.leafCounts[outcome], `Checkpoint leaf count ${outcome.toString()}`)
		if (leafCount >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error(`Checkpoint leaf count ${outcome.toString()} is too high`)
		unsignedInteger(checkpoint.unresolvedTotalsAttoRep[outcome], `Checkpoint unresolved total ${outcome.toString()}`)
		unsignedInteger(checkpoint.resolutionBalancesAttoRep[outcome], `Checkpoint resolution balance ${outcome.toString()}`)
	}
	return keccak256(
		encodeAbiParameters(
			[{ type: 'address' }, { type: 'bytes32[3]' }, { type: 'bytes32[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }, { type: 'uint256[3]' }],
			[checkpoint.sourceGame, checkpoint.carryRoots, checkpoint.nullifierRoots, bigIntTriple(checkpoint.leafCounts), bigIntTriple(checkpoint.unresolvedTotalsAttoRep), bigIntTriple(checkpoint.resolutionBalancesAttoRep)],
		),
	)
}

export function validateCarryCheckpoint(checkpoint: CarryCheckpoint) {
	getAddress(checkpoint.targetGame)
	getAddress(checkpoint.sourceGame)
	requireHash(checkpoint.snapshotId, 'Checkpoint snapshotId')
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		checkpointLeafCount(checkpoint, outcome)
	}
	const expected = carryCheckpointSnapshotId(checkpoint)
	if (checkpoint.snapshotId.toLowerCase() !== expected.toLowerCase()) throw new Error(`Checkpoint snapshotId ${checkpoint.snapshotId} does not match ${expected}`)
	return expected
}

function versionMatchesCheckpoint(version: CarryGameVersion, checkpoint: CarryCheckpoint) {
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		const outcomeState = version.state.outcomes[outcome]
		const commitment = carryCommitment(outcomeState.currentSlots)
		if (commitment.leafCount !== checkpoint.leafCounts[outcome]) return false
		if (commitment.root.toLowerCase() !== checkpoint.carryRoots[outcome].toLowerCase()) return false
		if (sparseNullifierRoot(outcomeState.nullifier).toLowerCase() !== checkpoint.nullifierRoots[outcome].toLowerCase()) return false
		if (outcomeState.unresolvedTotalAttoRep !== checkpoint.unresolvedTotalsAttoRep[outcome]) return false
		if (outcomeState.resolutionBalanceAttoRep !== checkpoint.resolutionBalancesAttoRep[outcome]) return false
	}
	return true
}

function stateCommitmentFingerprint(state: CarryGameState) {
	return JSON.stringify(state)
}

export function matchCarryCheckpointSourceVersion(source: CarryGameHistory, checkpoint: CarryCheckpoint): CarryGameVersion {
	validateCarryCheckpoint(checkpoint)
	if (source.game.toLowerCase() !== checkpoint.sourceGame.toLowerCase()) throw new Error(`Checkpoint source ${checkpoint.sourceGame} does not match carry history ${source.game}`)
	const matches = source.versions.filter(version => versionMatchesCheckpoint(version, checkpoint))
	if (matches.length === 0) throw new Error(`Checkpoint ${checkpoint.snapshotId} has no matching historical source version`)
	const fingerprint = stateCommitmentFingerprint(matches[0]?.state ?? emptyCarryGameState())
	if (matches.some(version => stateCommitmentFingerprint(version.state) !== fingerprint)) throw new Error(`Checkpoint ${checkpoint.snapshotId} ambiguously matches different source states`)
	const match = matches.at(-1)
	if (match === undefined) throw new Error('Matched carry source version is missing')
	return { ...match, mutation: cloneHistoryMutation(match.mutation), state: cloneCarryGameState(match.state) }
}

export function initializeCarryGameFromCheckpoint(game: Address, pool: Address, checkpoint: CarryCheckpoint, source: CarryGameHistory): CarryGameHistory {
	const normalizedGame = getAddress(game)
	if (normalizedGame.toLowerCase() !== checkpoint.targetGame.toLowerCase()) throw new Error(`Checkpoint target ${checkpoint.targetGame} does not match carry game ${normalizedGame}`)
	const sourceVersion = matchCarryCheckpointSourceVersion(source, checkpoint)
	const state: CarryGameState = { outcomes: [emptyOutcomeState(), emptyOutcomeState(), emptyOutcomeState()] }
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		const inherited = sourceVersion.state.outcomes[outcome]
		state.outcomes[outcome] = {
			currentSlots: inherited.currentSlots.map(cloneSlot),
			nullifier: cloneNullifier(inherited.nullifier),
			resolutionBalanceAttoRep: checkpoint.resolutionBalancesAttoRep[outcome],
			snapshotSlots: inherited.currentSlots.map(cloneSlot),
			unresolvedTotalAttoRep: checkpoint.unresolvedTotalsAttoRep[outcome],
		}
	}
	return {
		game: normalizedGame,
		pool: getAddress(pool),
		schemaVersion: 1,
		versions: [
			{
				mutation: {
					kind: 'checkpoint',
					snapshotId: checkpoint.snapshotId,
					sourceGame: checkpoint.sourceGame,
					sourceVersionSequence: sourceVersion.sequence,
				},
				sequence: '0',
				state,
			},
		],
	}
}

function matchingSnapshotSlots(state: CarryOutcomeState, parentDepositIndex: string, sourceNodeId?: string) {
	return state.snapshotSlots.flatMap((slot, index) => {
		if (slot.leaf.parentDepositIndex !== parentDepositIndex) return []
		if (sourceNodeId !== undefined && slot.leaf.sourceNodeId !== sourceNodeId) return []
		return [{ index, slot }]
	})
}

export function createCarriedDepositProof(state: CarryGameState, outcome: CarryOutcome, parentDepositIndex: string, sourceNodeId?: string): CarriedDepositProof {
	requireOutcome(outcome)
	unsignedInteger(parentDepositIndex, 'Carried proof parentDepositIndex')
	if (sourceNodeId !== undefined) unsignedInteger(sourceNodeId, 'Carried proof sourceNodeId')
	const outcomeState = state.outcomes[outcome]
	const matching = matchingSnapshotSlots(outcomeState, parentDepositIndex, sourceNodeId)
	if (matching.length !== 1) throw new Error(`Carried proof identity matched ${matching.length.toString()} snapshot leaves instead of one`)
	const selected = matching[0]
	if (selected === undefined) throw new Error('Carried proof snapshot leaf is missing')
	if (selected.slot.consumedLocally || selected.slot.hash === zeroHash) throw new Error('Locally consumed source leaf has no carried proof')
	if (selected.slot.hash.toLowerCase() !== hashCarryLeaf(selected.slot.leaf).toLowerCase()) throw new Error('Carried proof leaf hash is inconsistent')
	if (outcomeState.nullifier.consumed.some(entry => entry.parentDepositIndex === parentDepositIndex)) throw new Error(`Parent deposit ${parentDepositIndex} is already nullified`)
	const mmr = createMerkleMountainRangeProof(
		outcomeState.snapshotSlots.map(slot => slot.hash),
		selected.index,
	)
	const proof: CarriedDepositProof = {
		...mmr,
		amountAttoRep: selected.slot.leaf.amountAttoRep,
		cumulativeAmountAttoRep: selected.slot.leaf.cumulativeAmountAttoRep,
		depositor: selected.slot.leaf.depositor,
		nullifierSiblings: createSparseNullifierProof(outcomeState.nullifier, parentDepositIndex),
		parentDepositIndex,
		sourceNodeId: selected.slot.leaf.sourceNodeId,
	}
	verifyCarriedDepositProof(state, outcome, proof)
	return proof
}

export function verifyCarriedDepositProof(state: CarryGameState, outcome: CarryOutcome, proof: CarriedDepositProof) {
	requireOutcome(outcome)
	const leaf: CarryLeaf = {
		amountAttoRep: proof.amountAttoRep,
		cumulativeAmountAttoRep: proof.cumulativeAmountAttoRep,
		depositor: proof.depositor,
		outcome,
		parentDepositIndex: proof.parentDepositIndex,
		sourceNodeId: proof.sourceNodeId,
	}
	const outcomeState = state.outcomes[outcome]
	const commitment = carryCommitment(outcomeState.snapshotSlots)
	verifyMerkleMountainRangeProof(hashCarryLeaf(leaf), commitment.leafCount, commitment.root, proof)
	verifySparseNullifierAbsence(outcomeState.nullifier, proof.parentDepositIndex, proof.nullifierSiblings)
	return { carryRoot: commitment.root, nullifierRoot: sparseNullifierRoot(outcomeState.nullifier) }
}

function emptyAccumulatorInstrumentation(): CarryProofAccumulatorInstrumentation {
	return {
		accumulatorBuildSlotVisits: 0,
		fullStateMaterializations: 0,
		materializedSlotVisits: 0,
		mmrHashOperations: 0,
		nullifierHashOperations: 0,
		proofNodeReads: 0,
		streamingMutationCount: 0,
	}
}

function mmrNodeKey(height: number, start: bigint) {
	return `${height.toString()}:${start.toString()}`
}

function indexedMmrParent(left: Hash, right: Hash, instrumentation: CarryProofAccumulatorInstrumentation) {
	instrumentation.mmrHashOperations += 1
	return hashCarryParent(left, right)
}

function emptyIndexedMmr(): IndexedMerkleMountainRange {
	return {
		leafCount: 0,
		nodes: new Map(),
		peaks: Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => undefined),
	}
}

function appendIndexedMmr(index: IndexedMerkleMountainRange, hash: Hash, instrumentation: CarryProofAccumulatorInstrumentation) {
	requireHash(hash, 'Carry indexed MMR leaf hash')
	if (BigInt(index.leafCount) + 1n >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry indexed MMR exceeds the 64-peak capacity')
	let node = hash
	let nodeStart = BigInt(index.leafCount)
	let height = 0
	index.nodes.set(mmrNodeKey(0, nodeStart), node)
	while (((BigInt(index.leafCount) >> BigInt(height)) & 1n) === 1n) {
		const left = index.peaks[height]
		if (left === undefined) throw new Error(`Carry indexed MMR peak ${height.toString()} is missing during append`)
		nodeStart -= 1n << BigInt(height)
		node = indexedMmrParent(left, node, instrumentation)
		index.peaks[height] = undefined
		height += 1
		if (height >= CARRY_MMR_MAXIMUM_PEAKS) throw new Error('Carry indexed MMR is too tall')
		index.nodes.set(mmrNodeKey(height, nodeStart), node)
	}
	index.peaks[height] = node
	index.leafCount += 1
}

function buildIndexedMmr(slots: readonly CarryLeafSlot[], instrumentation: CarryProofAccumulatorInstrumentation) {
	const index = emptyIndexedMmr()
	for (const slot of slots) appendIndexedMmr(index, slot.hash, instrumentation)
	return index
}

function indexedMmrRoot(index: IndexedMerkleMountainRange, instrumentation: CarryProofAccumulatorInstrumentation): Hash {
	if (index.leafCount === 0) return zeroHash
	const occupied: Hash[] = []
	const leafCount = BigInt(index.leafCount)
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const peak = index.peaks[height]
		if (peak === undefined) throw new Error(`Carry indexed MMR peak ${height.toString()} is missing`)
		occupied.push(peak)
	}
	let root = occupied.at(-1)
	if (root === undefined) throw new Error('Nonempty carry indexed MMR has no root')
	for (let peakIndex = occupied.length - 2; peakIndex >= 0; peakIndex -= 1) {
		const peak = occupied[peakIndex]
		if (peak === undefined) throw new Error(`Carry indexed MMR bag peak ${peakIndex.toString()} is missing`)
		root = indexedMmrParent(peak, root, instrumentation)
	}
	return root
}

function indexedMmrPathRoot(index: IndexedMerkleMountainRange, globalLeafIndex: number, leafHash: Hash, instrumentation: CarryProofAccumulatorInstrumentation) {
	if (!Number.isSafeInteger(globalLeafIndex) || globalLeafIndex < 0 || globalLeafIndex >= index.leafCount) throw new Error('Carry indexed MMR leaf index is outside the MMR')
	const selected = peakForGlobalLeaf(BigInt(index.leafCount), BigInt(globalLeafIndex))
	let node = leafHash
	let nodeStart = BigInt(globalLeafIndex)
	for (let height = 0; height < selected.height; height += 1) {
		const subtreeSize = 1n << BigInt(height)
		const isRight = ((selected.relativeLeafIndex >> BigInt(height)) & 1n) === 1n
		const siblingStart = isRight ? nodeStart - subtreeSize : nodeStart + subtreeSize
		const sibling = index.nodes.get(mmrNodeKey(height, siblingStart))
		if (sibling === undefined) throw new Error(`Carry indexed MMR sibling is missing at height ${height.toString()}`)
		node = isRight ? indexedMmrParent(sibling, node, instrumentation) : indexedMmrParent(node, sibling, instrumentation)
		if (isRight) nodeStart = siblingStart
	}
	const peaks = [...index.peaks]
	peaks[selected.height] = node
	return indexedMmrRoot({ ...index, peaks }, instrumentation)
}

function replaceIndexedMmrLeaf(index: IndexedMerkleMountainRange, globalLeafIndex: number, leafHash: Hash, instrumentation: CarryProofAccumulatorInstrumentation) {
	const selected = peakForGlobalLeaf(BigInt(index.leafCount), BigInt(globalLeafIndex))
	let node = leafHash
	let nodeStart = BigInt(globalLeafIndex)
	index.nodes.set(mmrNodeKey(0, nodeStart), node)
	for (let height = 0; height < selected.height; height += 1) {
		const subtreeSize = 1n << BigInt(height)
		const isRight = ((selected.relativeLeafIndex >> BigInt(height)) & 1n) === 1n
		const siblingStart = isRight ? nodeStart - subtreeSize : nodeStart + subtreeSize
		const sibling = index.nodes.get(mmrNodeKey(height, siblingStart))
		if (sibling === undefined) throw new Error(`Carry indexed MMR sibling is missing at height ${height.toString()}`)
		node = isRight ? indexedMmrParent(sibling, node, instrumentation) : indexedMmrParent(node, sibling, instrumentation)
		if (isRight) nodeStart = siblingStart
		index.nodes.set(mmrNodeKey(height + 1, nodeStart), node)
	}
	index.peaks[selected.height] = node
}

function createIndexedMmrProof(index: IndexedMerkleMountainRange, globalLeafIndex: number, instrumentation: CarryProofAccumulatorInstrumentation): MerkleMountainRangeProof {
	if (!Number.isSafeInteger(globalLeafIndex) || globalLeafIndex < 0 || globalLeafIndex >= index.leafCount) throw new Error('Carry indexed proof leaf index is outside the MMR')
	const leafCount = BigInt(index.leafCount)
	const selected = peakForGlobalLeaf(leafCount, BigInt(globalLeafIndex))
	const siblings: Hash[] = []
	let nodeStart = BigInt(globalLeafIndex)
	for (let height = 0; height < selected.height; height += 1) {
		const subtreeSize = 1n << BigInt(height)
		const isRight = ((selected.relativeLeafIndex >> BigInt(height)) & 1n) === 1n
		const siblingStart = isRight ? nodeStart - subtreeSize : nodeStart + subtreeSize
		const sibling = index.nodes.get(mmrNodeKey(height, siblingStart))
		if (sibling === undefined) throw new Error(`Carry indexed proof sibling is missing at height ${height.toString()}`)
		siblings.push(sibling)
		if (isRight) nodeStart = siblingStart
	}
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n || height === selected.height) continue
		const peak = index.peaks[height]
		if (peak === undefined) throw new Error(`Carry indexed proof peak ${height.toString()} is missing`)
		siblings.push(peak)
	}
	instrumentation.proofNodeReads += siblings.length
	return {
		leafIndex: selected.relativeLeafIndex.toString(),
		merkleMountainRangePeakIndex: selected.height.toString(),
		merkleMountainRangeSiblings: siblings,
	}
}

function nullifierNodeKey(depth: number, nodeIndex: bigint) {
	return `${depth.toString()}:${nodeIndex.toString()}`
}

function indexedNullifierParent(left: Hash, right: Hash, instrumentation: CarryProofAccumulatorInstrumentation) {
	instrumentation.nullifierHashOperations += 1
	return hashCarryParent(left, right)
}

function emptyIndexedNullifier(): IndexedSparseNullifier {
	return { consumedByParent: new Map(), nodes: new Map(), ownerByPath: new Map() }
}

function addIndexedNullifierEntry(index: IndexedSparseNullifier, entry: SparseNullifierEntry, instrumentation: CarryProofAccumulatorInstrumentation) {
	if (index.consumedByParent.has(entry.parentDepositIndex)) throw new Error(`Parent deposit ${entry.parentDepositIndex} is already nullified`)
	const expectedPath = nullifierPath(entry.parentDepositIndex).toString()
	if (entry.path !== expectedPath) throw new Error(`Nullifier path for parent deposit ${entry.parentDepositIndex} is invalid`)
	const previousOwner = index.ownerByPath.get(entry.path)
	if (previousOwner !== undefined && previousOwner !== entry.parentDepositIndex) {
		throw new Error(`Nullifier path collision between parent deposits ${previousOwner} and ${entry.parentDepositIndex}`)
	}
	let nodeIndex = BigInt(entry.path)
	let nodeHash = NULLIFIER_CONSUMED_LEAF
	index.nodes.set(nullifierNodeKey(0, nodeIndex), nodeHash)
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const zero = NULLIFIER_ZERO_HASHES[depth]
		if (zero === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
		const sibling = index.nodes.get(nullifierNodeKey(depth, nodeIndex ^ 1n)) ?? zero
		nodeHash = (nodeIndex & 1n) === 0n ? indexedNullifierParent(nodeHash, sibling, instrumentation) : indexedNullifierParent(sibling, nodeHash, instrumentation)
		nodeIndex >>= 1n
		index.nodes.set(nullifierNodeKey(depth + 1, nodeIndex), nodeHash)
	}
	index.consumedByParent.set(entry.parentDepositIndex, { ...entry })
	index.ownerByPath.set(entry.path, entry.parentDepositIndex)
}

function buildIndexedNullifier(state: SparseNullifierState, instrumentation: CarryProofAccumulatorInstrumentation) {
	validateSparseNullifierState(state)
	const index = emptyIndexedNullifier()
	for (const entry of state.consumed) addIndexedNullifierEntry(index, entry, instrumentation)
	return index
}

function indexedNullifierRoot(index: IndexedSparseNullifier) {
	const emptyRoot = NULLIFIER_ZERO_HASHES[CARRY_NULLIFIER_DEPTH]
	if (emptyRoot === undefined) throw new Error('Empty nullifier root is missing')
	return index.nodes.get(nullifierNodeKey(CARRY_NULLIFIER_DEPTH, 0n)) ?? emptyRoot
}

function createIndexedNullifierProof(index: IndexedSparseNullifier, parentDepositIndex: string, instrumentation: CarryProofAccumulatorInstrumentation) {
	let nodeIndex = nullifierPath(parentDepositIndex)
	const siblings: Hash[] = []
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const zero = NULLIFIER_ZERO_HASHES[depth]
		if (zero === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
		siblings.push(index.nodes.get(nullifierNodeKey(depth, nodeIndex ^ 1n)) ?? zero)
		nodeIndex >>= 1n
	}
	instrumentation.proofNodeReads += siblings.length
	return siblings
}

function leafIdentity(leaf: CarryLeaf) {
	return `${leaf.outcome.toString()}:${leaf.parentDepositIndex}:${leaf.sourceNodeId}:${leaf.depositor.toLowerCase()}:${leaf.amountAttoRep}`
}

function createOutcomeAccumulator(state: CarryOutcomeState, instrumentation: CarryProofAccumulatorInstrumentation): CarryOutcomeAccumulator {
	requireSlots(state.snapshotSlots, 'Carry accumulator snapshot slots')
	requireSlots(state.currentSlots, 'Carry accumulator current slots')
	if (state.currentSlots.length < state.snapshotSlots.length) throw new Error('Carry accumulator current slots are shorter than its snapshot')
	const currentSlotIndexByIdentity = new Map<string, number>()
	const currentSlotIndexByParent = new Map<string, number>()
	for (const [slotIndex, slot] of state.currentSlots.entries()) {
		const identity = leafIdentity(slot.leaf)
		if (currentSlotIndexByIdentity.has(identity)) throw new Error(`Carry accumulator leaf identity ${identity} is duplicated`)
		if (currentSlotIndexByParent.has(slot.leaf.parentDepositIndex)) throw new Error(`Carry parent deposit ${slot.leaf.parentDepositIndex} is duplicated`)
		currentSlotIndexByIdentity.set(identity, slotIndex)
		currentSlotIndexByParent.set(slot.leaf.parentDepositIndex, slotIndex)
	}
	const snapshotSlotIndexesByParent = new Map<string, number[]>()
	for (const [slotIndex, slot] of state.snapshotSlots.entries()) {
		const indexes = snapshotSlotIndexesByParent.get(slot.leaf.parentDepositIndex)
		if (indexes === undefined) snapshotSlotIndexesByParent.set(slot.leaf.parentDepositIndex, [slotIndex])
		else indexes.push(slotIndex)
	}
	instrumentation.accumulatorBuildSlotVisits += state.snapshotSlots.length + state.currentSlots.length + state.nullifier.consumed.length
	return {
		currentMmr: buildIndexedMmr(state.currentSlots, instrumentation),
		currentSlotIndexByIdentity,
		currentSlotIndexByParent,
		nullifier: buildIndexedNullifier(state.nullifier, instrumentation),
		snapshotMmr: buildIndexedMmr(state.snapshotSlots, instrumentation),
		snapshotSlotIndexesByParent,
	}
}

export function createCarryProofAccumulator(game: Address, pool: Address, initialState: CarryGameState = emptyCarryGameState()): CarryProofAccumulator {
	const state = cloneCarryGameState(initialState)
	carryGameAccounting(state)
	const instrumentation = emptyAccumulatorInstrumentation()
	return {
		game: getAddress(game),
		instrumentation,
		outcomes: [createOutcomeAccumulator(state.outcomes[0], instrumentation), createOutcomeAccumulator(state.outcomes[1], instrumentation), createOutcomeAccumulator(state.outcomes[2], instrumentation)],
		pool: getAddress(pool),
		state,
	}
}

export function carryProofAccumulatorAccounting(accumulator: CarryProofAccumulator) {
	return carryGameAccounting(accumulator.state)
}

export function carryProofAccumulatorCommitment(accumulator: CarryProofAccumulator, outcome: CarryOutcome, source: 'current' | 'snapshot' = 'current'): CarryCommitment {
	requireOutcome(outcome)
	const index = source === 'current' ? accumulator.outcomes[outcome].currentMmr : accumulator.outcomes[outcome].snapshotMmr
	return {
		leafCount: index.leafCount.toString(),
		peaks: index.peaks.map(peak => peak ?? zeroHash),
		root: indexedMmrRoot(index, accumulator.instrumentation),
	}
}

export function carryProofAccumulatorNullifierRoot(accumulator: CarryProofAccumulator, outcome: CarryOutcome) {
	requireOutcome(outcome)
	return indexedNullifierRoot(accumulator.outcomes[outcome].nullifier)
}

export function carryProofAccumulatorSnapshotSlots(accumulator: CarryProofAccumulator, outcome: CarryOutcome): readonly CarryLeafSlot[] {
	requireOutcome(outcome)
	return accumulator.state.outcomes[outcome].snapshotSlots
}

export function carryProofAccumulatorIsNullified(accumulator: CarryProofAccumulator, outcome: CarryOutcome, parentDepositIndex: string) {
	requireOutcome(outcome)
	unsignedInteger(parentDepositIndex, 'Carry nullifier parentDepositIndex')
	return accumulator.outcomes[outcome].nullifier.consumedByParent.has(parentDepositIndex)
}

export function appendCarryLeafToAccumulator(accumulator: CarryProofAccumulator, leaf: CarryLeaf) {
	requireLeaf(leaf)
	const outcomeState = accumulator.state.outcomes[leaf.outcome]
	const outcomeIndex = accumulator.outcomes[leaf.outcome]
	if (outcomeIndex.currentSlotIndexByParent.has(leaf.parentDepositIndex)) {
		throw new Error(`Carry parent deposit ${leaf.parentDepositIndex} already exists for outcome ${leaf.outcome.toString()}`)
	}
	const amountAttoRep = BigInt(leaf.amountAttoRep)
	const expectedCumulativeAmountAttoRep = BigInt(outcomeState.resolutionBalanceAttoRep) + amountAttoRep
	if (BigInt(leaf.cumulativeAmountAttoRep) !== expectedCumulativeAmountAttoRep) {
		throw new Error(`Carry leaf cumulative amount ${leaf.cumulativeAmountAttoRep} does not follow resolution balance ${outcomeState.resolutionBalanceAttoRep}`)
	}
	const slot: CarryLeafSlot = {
		consumedLocally: false,
		hash: hashCarryLeaf(leaf),
		leaf: cloneLeaf(leaf),
		originGame: accumulator.game,
	}
	const slotIndex = outcomeState.currentSlots.length
	appendIndexedMmr(outcomeIndex.currentMmr, slot.hash, accumulator.instrumentation)
	outcomeState.currentSlots.push(slot)
	outcomeIndex.currentSlotIndexByIdentity.set(leafIdentity(leaf), slotIndex)
	outcomeIndex.currentSlotIndexByParent.set(leaf.parentDepositIndex, slotIndex)
	outcomeState.unresolvedTotalAttoRep = (BigInt(outcomeState.unresolvedTotalAttoRep) + amountAttoRep).toString()
	outcomeState.resolutionBalanceAttoRep = leaf.cumulativeAmountAttoRep
	accumulator.instrumentation.streamingMutationCount += 1
}

export function applyCarryConsumptionToAccumulator(accumulator: CarryProofAccumulator, consumption: AuthenticatedCarryConsumption): 'local' | 'inherited' {
	requireOutcome(consumption.outcome)
	getAddress(consumption.depositor)
	unsignedInteger(consumption.amountAttoRep, 'Carry consumption amountAttoRep')
	unsignedInteger(consumption.parentDepositIndex, 'Carry consumption parentDepositIndex')
	unsignedInteger(consumption.sourceNodeId, 'Carry consumption sourceNodeId')
	requireHash(consumption.expectedCarryRoot, 'Carry consumption expected carry root')
	requireHash(consumption.expectedNullifierRoot, 'Carry consumption expected nullifier root')
	const resultingUnresolvedTotalAttoRep = unsignedInteger(consumption.resultingUnresolvedTotalAttoRep, 'Carry consumption resultingUnresolvedTotalAttoRep')
	const outcomeState = accumulator.state.outcomes[consumption.outcome]
	const outcomeIndex = accumulator.outcomes[consumption.outcome]
	const previousUnresolvedTotalAttoRep = BigInt(outcomeState.unresolvedTotalAttoRep)
	if (resultingUnresolvedTotalAttoRep > previousUnresolvedTotalAttoRep) throw new Error('Carry consumption resulting unresolved total increased')
	const slotIndex = outcomeIndex.currentSlotIndexByIdentity.get(`${consumption.outcome.toString()}:${consumption.parentDepositIndex}:${consumption.sourceNodeId}:${consumption.depositor.toLowerCase()}:${consumption.amountAttoRep}`)
	if (slotIndex === undefined) throw new Error('Carry consumption matched 0 leaves instead of one')
	const slot = outcomeState.currentSlots[slotIndex]
	if (slot === undefined) throw new Error('Carry consumption slot is missing')
	let kind: 'local' | 'inherited'
	if (slot.originGame.toLowerCase() === accumulator.game.toLowerCase()) {
		if (slotIndex < outcomeState.snapshotSlots.length) throw new Error('Carry accumulator marks a target-local leaf as inherited')
		if (slot.consumedLocally) throw new Error(`Local carry deposit ${consumption.parentDepositIndex} is already consumed`)
		const amountAttoRep = BigInt(consumption.amountAttoRep)
		if (amountAttoRep > previousUnresolvedTotalAttoRep || previousUnresolvedTotalAttoRep - amountAttoRep !== resultingUnresolvedTotalAttoRep) {
			throw new Error('Local carry consumption resulting unresolved total is inconsistent')
		}
		const prospectiveCarryRoot = indexedMmrPathRoot(outcomeIndex.currentMmr, slotIndex, zeroHash, accumulator.instrumentation)
		const currentNullifierRoot = indexedNullifierRoot(outcomeIndex.nullifier)
		if (prospectiveCarryRoot.toLowerCase() !== consumption.expectedCarryRoot.toLowerCase()) {
			throw new Error(`Carry consumption root ${prospectiveCarryRoot} does not match event root ${consumption.expectedCarryRoot}`)
		}
		if (currentNullifierRoot.toLowerCase() !== consumption.expectedNullifierRoot.toLowerCase()) {
			throw new Error(`Carry consumption nullifier ${currentNullifierRoot} does not match event root ${consumption.expectedNullifierRoot}`)
		}
		replaceIndexedMmrLeaf(outcomeIndex.currentMmr, slotIndex, zeroHash, accumulator.instrumentation)
		outcomeState.currentSlots[slotIndex] = { ...cloneSlot(slot), consumedLocally: true, hash: zeroHash }
		kind = 'local'
	} else {
		if (slotIndex >= outcomeState.snapshotSlots.length) throw new Error('Carry accumulator marks an inherited leaf as target-local')
		if (slot.consumedLocally || slot.hash === zeroHash) throw new Error('A locally consumed source leaf cannot be consumed as an inherited proof')
		if (outcomeIndex.nullifier.consumedByParent.has(consumption.parentDepositIndex)) throw new Error(`Parent deposit ${consumption.parentDepositIndex} is already nullified`)
		const path = nullifierPath(consumption.parentDepositIndex).toString()
		const previousOwner = outcomeIndex.nullifier.ownerByPath.get(path)
		if (previousOwner !== undefined && previousOwner !== consumption.parentDepositIndex) {
			throw new Error(`Nullifier path collision between parent deposits ${previousOwner} and ${consumption.parentDepositIndex}`)
		}
		const currentCarryRoot = indexedMmrRoot(outcomeIndex.currentMmr, accumulator.instrumentation)
		const absenceProof = createIndexedNullifierProof(outcomeIndex.nullifier, consumption.parentDepositIndex, accumulator.instrumentation)
		const prospectiveNullifierRoot = computeNullifierRootFromProof(consumption.parentDepositIndex, absenceProof, NULLIFIER_CONSUMED_LEAF)
		if (currentCarryRoot.toLowerCase() !== consumption.expectedCarryRoot.toLowerCase()) {
			throw new Error(`Carry consumption root ${currentCarryRoot} does not match event root ${consumption.expectedCarryRoot}`)
		}
		if (prospectiveNullifierRoot.toLowerCase() !== consumption.expectedNullifierRoot.toLowerCase()) {
			throw new Error(`Carry consumption nullifier ${prospectiveNullifierRoot} does not match event root ${consumption.expectedNullifierRoot}`)
		}
		addIndexedNullifierEntry(outcomeIndex.nullifier, { parentDepositIndex: consumption.parentDepositIndex, path }, accumulator.instrumentation)
		kind = 'inherited'
	}
	outcomeState.unresolvedTotalAttoRep = consumption.resultingUnresolvedTotalAttoRep
	accumulator.instrumentation.streamingMutationCount += 1
	return kind
}

export function setCarryProofAccumulatorAccounting(accumulator: CarryProofAccumulator, accounting: CarryAccounting) {
	validateCarryAccounting(accounting, 'Carry accumulator accounting update')
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		accumulator.state.outcomes[outcome].unresolvedTotalAttoRep = accounting.unresolvedTotalsAttoRep[outcome]
		accumulator.state.outcomes[outcome].resolutionBalanceAttoRep = accounting.resolutionBalancesAttoRep[outcome]
	}
	accumulator.instrumentation.streamingMutationCount += 1
}

function canonicalNullifierEntries(index: IndexedSparseNullifier) {
	return [...index.consumedByParent.values()]
		.map(entry => ({ ...entry }))
		.sort((left, right) => {
			const leftParent = BigInt(left.parentDepositIndex)
			const rightParent = BigInt(right.parentDepositIndex)
			if (leftParent < rightParent) return -1
			if (leftParent > rightParent) return 1
			return 0
		})
}

export function materializeCarryProofAccumulatorState(accumulator: CarryProofAccumulator) {
	let visits = 0
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		const outcomeState = accumulator.state.outcomes[outcome]
		outcomeState.nullifier = { consumed: canonicalNullifierEntries(accumulator.outcomes[outcome].nullifier) }
		visits += outcomeState.snapshotSlots.length + outcomeState.currentSlots.length + outcomeState.nullifier.consumed.length
	}
	accumulator.instrumentation.fullStateMaterializations += 1
	accumulator.instrumentation.materializedSlotVisits += visits
	return cloneCarryGameState(accumulator.state)
}

export function carryProofAccumulatorMatchesCheckpoint(accumulator: CarryProofAccumulator, checkpoint: CarryCheckpoint) {
	validateCarryCheckpoint(checkpoint)
	if (accumulator.game.toLowerCase() !== checkpoint.sourceGame.toLowerCase()) return false
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		const commitment = carryProofAccumulatorCommitment(accumulator, outcome)
		if (commitment.leafCount !== checkpoint.leafCounts[outcome]) return false
		if (commitment.root.toLowerCase() !== checkpoint.carryRoots[outcome].toLowerCase()) return false
		if (carryProofAccumulatorNullifierRoot(accumulator, outcome).toLowerCase() !== checkpoint.nullifierRoots[outcome].toLowerCase()) return false
		if (accumulator.state.outcomes[outcome].unresolvedTotalAttoRep !== checkpoint.unresolvedTotalsAttoRep[outcome]) return false
		if (accumulator.state.outcomes[outcome].resolutionBalanceAttoRep !== checkpoint.resolutionBalancesAttoRep[outcome]) return false
	}
	return true
}

export function initializeCarryProofAccumulatorFromCheckpoint(game: Address, pool: Address, checkpoint: CarryCheckpoint, source: { game: Address; state: CarryGameState }) {
	const normalizedGame = getAddress(game)
	const normalizedSourceGame = getAddress(source.game)
	validateCarryCheckpoint(checkpoint)
	if (normalizedGame.toLowerCase() !== checkpoint.targetGame.toLowerCase()) throw new Error(`Checkpoint target ${checkpoint.targetGame} does not match carry game ${normalizedGame}`)
	if (normalizedSourceGame.toLowerCase() !== checkpoint.sourceGame.toLowerCase()) throw new Error(`Checkpoint source ${checkpoint.sourceGame} does not match carry source ${normalizedSourceGame}`)
	const sourceAccumulator = createCarryProofAccumulator(normalizedSourceGame, pool, source.state)
	if (!carryProofAccumulatorMatchesCheckpoint(sourceAccumulator, checkpoint)) throw new Error(`Checkpoint ${checkpoint.snapshotId} does not match its source state`)
	const state: CarryGameState = { outcomes: [emptyOutcomeState(), emptyOutcomeState(), emptyOutcomeState()] }
	for (let outcome = 0; outcome < 3; outcome += 1) {
		requireOutcome(outcome)
		const inherited = source.state.outcomes[outcome]
		state.outcomes[outcome] = {
			currentSlots: inherited.currentSlots.map(cloneSlot),
			nullifier: cloneNullifier(inherited.nullifier),
			resolutionBalanceAttoRep: checkpoint.resolutionBalancesAttoRep[outcome],
			snapshotSlots: inherited.currentSlots.map(cloneSlot),
			unresolvedTotalAttoRep: checkpoint.unresolvedTotalsAttoRep[outcome],
		}
	}
	const initialized = createCarryProofAccumulator(normalizedGame, pool, state)
	initialized.instrumentation.accumulatorBuildSlotVisits += sourceAccumulator.instrumentation.accumulatorBuildSlotVisits
	initialized.instrumentation.mmrHashOperations += sourceAccumulator.instrumentation.mmrHashOperations
	initialized.instrumentation.nullifierHashOperations += sourceAccumulator.instrumentation.nullifierHashOperations
	return initialized
}

export function createCarriedDepositProofFromAccumulator(accumulator: CarryProofAccumulator, outcome: CarryOutcome, parentDepositIndex: string, sourceNodeId?: string): CarriedDepositProof {
	requireOutcome(outcome)
	unsignedInteger(parentDepositIndex, 'Carried proof parentDepositIndex')
	if (sourceNodeId !== undefined) unsignedInteger(sourceNodeId, 'Carried proof sourceNodeId')
	const outcomeState = accumulator.state.outcomes[outcome]
	const outcomeIndex = accumulator.outcomes[outcome]
	const matching = (outcomeIndex.snapshotSlotIndexesByParent.get(parentDepositIndex) ?? []).filter(slotIndex => {
		const slot = outcomeState.snapshotSlots[slotIndex]
		return slot !== undefined && (sourceNodeId === undefined || slot.leaf.sourceNodeId === sourceNodeId)
	})
	if (matching.length !== 1) throw new Error(`Carried proof identity matched ${matching.length.toString()} snapshot leaves instead of one`)
	const slotIndex = matching[0]
	if (slotIndex === undefined) throw new Error('Carried proof snapshot leaf is missing')
	const slot = outcomeState.snapshotSlots[slotIndex]
	if (slot === undefined) throw new Error('Carried proof snapshot slot is missing')
	if (slot.consumedLocally || slot.hash === zeroHash) throw new Error('Locally consumed source leaf has no carried proof')
	if (slot.hash.toLowerCase() !== hashCarryLeaf(slot.leaf).toLowerCase()) throw new Error('Carried proof leaf hash is inconsistent')
	if (outcomeIndex.nullifier.consumedByParent.has(parentDepositIndex)) throw new Error(`Parent deposit ${parentDepositIndex} is already nullified`)
	const mmr = createIndexedMmrProof(outcomeIndex.snapshotMmr, slotIndex, accumulator.instrumentation)
	const nullifierSiblings = createIndexedNullifierProof(outcomeIndex.nullifier, parentDepositIndex, accumulator.instrumentation)
	const proof: CarriedDepositProof = {
		...mmr,
		amountAttoRep: slot.leaf.amountAttoRep,
		cumulativeAmountAttoRep: slot.leaf.cumulativeAmountAttoRep,
		depositor: slot.leaf.depositor,
		nullifierSiblings,
		parentDepositIndex,
		sourceNodeId: slot.leaf.sourceNodeId,
	}
	const snapshotCommitment = carryProofAccumulatorCommitment(accumulator, outcome, 'snapshot')
	verifyMerkleMountainRangeProof(slot.hash, snapshotCommitment.leafCount, snapshotCommitment.root, proof)
	const nullifierRoot = carryProofAccumulatorNullifierRoot(accumulator, outcome)
	const proofNullifierRoot = computeNullifierRootFromProof(parentDepositIndex, nullifierSiblings, zeroHash)
	if (proofNullifierRoot.toLowerCase() !== nullifierRoot.toLowerCase()) throw new Error(`Nullifier proof root ${proofNullifierRoot} does not match ${nullifierRoot}`)
	return proof
}

export function validateCarryGameHistory(history: CarryGameHistory) {
	const schemaVersion: number = history.schemaVersion
	if (schemaVersion !== 1) throw new Error(`Unsupported carry history schema ${schemaVersion.toString()}`)
	getAddress(history.game)
	getAddress(history.pool)
	if (history.versions.length === 0) throw new Error('Carry history has no versions')
	let inheritedSnapshotFingerprint: string | undefined
	for (let versionIndex = 0; versionIndex < history.versions.length; versionIndex += 1) {
		const version = history.versions[versionIndex]
		if (version === undefined) throw new Error(`Carry history version ${versionIndex.toString()} is missing`)
		if (version.sequence !== versionIndex.toString()) throw new Error(`Carry history version ${version.sequence} is not contiguous`)
		for (let outcome = 0; outcome < 3; outcome += 1) {
			requireOutcome(outcome)
			const outcomeState = version.state.outcomes[outcome]
			requireSlots(outcomeState.snapshotSlots, `Carry history version ${version.sequence} outcome ${outcome.toString()} snapshot`)
			requireSlots(outcomeState.currentSlots, `Carry history version ${version.sequence} outcome ${outcome.toString()} current`)
			unsignedInteger(outcomeState.unresolvedTotalAttoRep, `Carry history version ${version.sequence} outcome ${outcome.toString()} unresolved total`)
			unsignedInteger(outcomeState.resolutionBalanceAttoRep, `Carry history version ${version.sequence} outcome ${outcome.toString()} resolution balance`)
			if (outcomeState.currentSlots.length < outcomeState.snapshotSlots.length) throw new Error('Carry current slots are shorter than the immutable snapshot')
			validateSparseNullifierState(outcomeState.nullifier)
		}
		const snapshotFingerprint = JSON.stringify(version.state.outcomes.map(outcomeState => outcomeState.snapshotSlots))
		if (inheritedSnapshotFingerprint === undefined) inheritedSnapshotFingerprint = snapshotFingerprint
		else if (snapshotFingerprint !== inheritedSnapshotFingerprint) throw new Error('Carry history mutated its immutable inherited snapshot')
	}
	return history
}
