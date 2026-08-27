import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { canonicalUintString, type CanonicalUintString } from '../core/units.ts'
import {
	appendCarryLeafToAccumulator,
	applyCarryConsumptionToAccumulator,
	carryCheckpointSnapshotId,
	carryCommitment,
	carryGameAccounting,
	carryProofAccumulatorAccounting,
	carryProofAccumulatorCommitment,
	carryProofAccumulatorConsumptionSlot,
	carryProofAccumulatorIsNullified,
	carryProofAccumulatorNullifierRoot,
	carryProofAccumulatorSnapshotSlots,
	CARRY_MMR_MAXIMUM_PEAKS,
	CARRY_NULLIFIER_DEPTH,
	createCarriedDepositProofFromAccumulator,
	createCarryProofAccumulator,
	initializeCarryProofAccumulatorFromCheckpoint,
	materializeCarryProofAccumulatorState,
	parseCarryGameState,
	setCarryProofAccumulatorAccounting,
	sparseNullifierRoot,
	validateCarryCheckpoint,
	type CarriedDepositProof,
	type CarryCheckpoint,
	type CarryAccounting,
	type CarryGameState,
	type CarryLeaf,
	type CarryLeafSlot,
	type CarryOutcome,
	type CarryProofAccumulator,
	type CarryProofAccumulatorInstrumentation,
	type CarryTriple,
} from './carry-proof-index.ts'

export const CARRY_PROOF_JOURNAL_SCHEMA_VERSION = 3
export const CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD = 8_192
export const CARRY_PROOF_JOURNAL_SEGMENT_BYTES = 1024 * 1024
export const CARRY_PROOF_JOURNAL_MANIFEST_BYTES = 64 * 1024
// Parsing, checksum verification, normalization, and indexed replay coexist
// transiently. Keep the wire envelope well below the process heap budget
// instead of treating serialized bytes as if they were peak memory.
export const CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES = 16 * 1024 * 1024
export const CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS = 32_768
export const CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS = 16_384
export const CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST = 262_144
export const CARRY_PROOF_JOURNAL_MAXIMUM_PROOF_CANDIDATES = 32
export const CARRY_PROOF_JOURNAL_MAXIMUM_SEGMENTS = CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES / CARRY_PROOF_JOURNAL_SEGMENT_BYTES

const UINT_PATTERN = /^(?:0|[1-9]\d*)$/
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const MAXIMUM_UINT256 = (1n << 256n) - 1n
const MAXIMUM_UINT256_DECIMAL = MAXIMUM_UINT256.toString()
const JOURNAL_ENVELOPE_FORMAT = 'zoltar-chaos-carry-proof-journal-v3'
const SEGMENTED_JOURNAL_ENVELOPE_FORMAT = 'zoltar-chaos-carry-proof-journal-segmented-v3'
const CARRY_EVENT_MMR_LEAF_DOMAIN = 'zoltar-chaos-carry-event-mmr-leaf-v1'
const CARRY_EVENT_MMR_PARENT_DOMAIN = 'zoltar-chaos-carry-event-mmr-parent-v1'
const CARRY_EVENT_MMR_ROOT_DOMAIN = 'zoltar-chaos-carry-event-mmr-root-v1'
const CARRY_DIRECT_CLAIM_MMR_LEAF_DOMAIN = 'zoltar-chaos-carry-direct-claim-mmr-leaf-v1'
const CARRY_DIRECT_CLAIM_MMR_PARENT_DOMAIN = 'zoltar-chaos-carry-direct-claim-mmr-parent-v1'
const CARRY_DIRECT_CLAIM_MMR_ROOT_DOMAIN = 'zoltar-chaos-carry-direct-claim-mmr-root-v1'
const CARRY_PREFIX_COMMITMENT_DOMAIN = 'zoltar-chaos-carry-prefix-commitment-v1'
const CARRY_PROOF_JOURNAL_DIRECTORY_MAXIMUM_ENTRIES = 256
const CARRY_PROOF_JOURNAL_SEGMENT_DIRECTORY_PATTERN = /^carry-journal-[0-9a-f]{64}-segments-v3$/
const CARRY_PROOF_JOURNAL_SEGMENT_FILE_PATTERN = /^segment\.[0-9a-f-]{36}\.\d{8}\.part$/
const CARRY_PROOF_JOURNAL_TEMPORARY_FILE_PATTERN = /^temporary\.\d+\.[0-9a-f-]{36}\.tmp$/

type CarryProofJournalPostCommitFaultPoint = 'cleanup' | 'parent-directory-sync' | 'segment-directory-sync'
let carryProofJournalPostCommitFaultForTesting: CarryProofJournalPostCommitFaultPoint | undefined

/** Installs a one-shot post-rename fault for deterministic commit-boundary tests. */
export function injectCarryProofJournalPostCommitFaultForTesting(point: CarryProofJournalPostCommitFaultPoint) {
	carryProofJournalPostCommitFaultForTesting = point
}

export const LOCAL_DEPOSIT_APPENDED_SIGNATURE = 'LocalDepositAppended(uint256,uint8,address,uint256,uint256,uint256)'
export const FORK_CARRY_CHECKPOINT_SIGNATURE = 'ForkCarryCheckpoint(address,bytes32,bytes32[3],bytes32[3],uint256[3],uint256[3],uint256[3])'
export const CARRY_DEPOSIT_CONSUMED_SIGNATURE = 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'
export const CLAIM_DEPOSIT_SIGNATURE = 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)'
export const TRUTH_AUCTION_HAIRCUT_SIGNATURE = 'TruthAuctionHaircutApplied(uint256,uint256,uint256,uint256)'
export const DISPUTE_STAKED_REP_DRAINED_SIGNATURE = 'DisputeStakedRepDrainedAtFork(address,address,uint256)'
export const SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE = 'SecurityPoolForkSnapshot(address,address,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)'

export interface CarryJournalCursor {
	blockNumber: string
	blockHash: Hash
}

export interface CarryJournalPosition extends CarryJournalCursor {
	transactionIndex: string
	transactionHash: Hash
	logIndex: string
}

interface CarryJournalEventBase {
	emitter: Address
	pool: Address
	position: CarryJournalPosition
}

export interface LocalDepositAppendedJournalEvent extends CarryJournalEventBase {
	kind: 'local-deposit-appended'
	signature: typeof LOCAL_DEPOSIT_APPENDED_SIGNATURE
	nodeId: string
	outcome: CarryOutcome
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	cumulativeAmountAttoRep: CanonicalUintString
}

export interface ForkCarryCheckpointJournalEvent extends CarryJournalEventBase {
	kind: 'fork-carry-checkpoint'
	signature: typeof FORK_CARRY_CHECKPOINT_SIGNATURE
	sourceGame: Address
	sourcePool: Address
	snapshotId: Hash
	carryRoots: CarryTriple<Hash>
	nullifierRoots: CarryTriple<Hash>
	leafCounts: CarryTriple<string>
	unresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	resolutionBalancesAttoRep: CarryTriple<CanonicalUintString>
}

export interface CarryDepositConsumedJournalEvent extends CarryJournalEventBase {
	kind: 'carry-deposit-consumed'
	signature: typeof CARRY_DEPOSIT_CONSUMED_SIGNATURE
	parentDepositIndex: string
	sourceNodeId: string
	depositor: Address
	outcome: CarryOutcome
	amountAttoRep: CanonicalUintString
	reason: 0 | 1 | 2 | 3 | 4
	resultingUnresolvedTotalAttoRep: CanonicalUintString
	resultingNullifierRoot: Hash
	resultingCarryRoot: Hash
}

export interface ClaimDepositJournalEvent extends CarryJournalEventBase {
	kind: 'claim-deposit'
	signature: typeof CLAIM_DEPOSIT_SIGNATURE
	depositor: Address
	outcome: CarryOutcome
	parentDepositIndex: string
	originalDepositAmountAttoRep: CanonicalUintString
	amountToWithdrawAttoRep: CanonicalUintString
	burnAmountAttoRep: CanonicalUintString
	transferredRep: boolean
}

/** The two accounting triples are derived from earlier canonical events. */
export interface TruthAuctionHaircutJournalEvent extends CarryJournalEventBase {
	kind: 'truth-auction-haircut'
	signature: typeof TRUTH_AUCTION_HAIRCUT_SIGNATURE
	repBeforeAttoRep: CanonicalUintString
	repRemovedAttoRep: CanonicalUintString
	repRemainingAttoRep: CanonicalUintString
	rebasedElapsed: string
	resultingUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	resultingResolutionBalancesAttoRep: CarryTriple<CanonicalUintString>
}

export interface DisputeStakedRepDrainedJournalEvent extends CarryJournalEventBase {
	kind: 'dispute-staked-rep-drained-at-fork'
	signature: typeof DISPUTE_STAKED_REP_DRAINED_SIGNATURE
	sourceGame: Address
	amountAttoRep: CanonicalUintString
}

export interface SecurityPoolForkSnapshotJournalEvent extends CarryJournalEventBase {
	kind: 'security-pool-fork-snapshot'
	signature: typeof SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE
	migrationProxy: Address
	ownFork: boolean
	unresolvedEscalation: boolean
	settlementCollateralAtForkAttoEth: CanonicalUintString
	totalPoolHeldRepAtForkAttoRep: CanonicalUintString
	auctionableAttoRepAtFork: CanonicalUintString
	escalationSourceRepAtForkAttoRep: CanonicalUintString
	escalationChildRepAtForkAttoRep: CanonicalUintString
	escalationStartBondAtForkAttoRep: CanonicalUintString
	escalationNonDecisionThresholdAtForkAttoRep: CanonicalUintString
	escalationElapsedAtFork: string
	escalationSnapshotId: Hash
}

export type CarryProofJournalEvent = LocalDepositAppendedJournalEvent | ForkCarryCheckpointJournalEvent | CarryDepositConsumedJournalEvent | ClaimDepositJournalEvent | TruthAuctionHaircutJournalEvent | DisputeStakedRepDrainedJournalEvent | SecurityPoolForkSnapshotJournalEvent

export interface CarryJournalRawAccounting {
	inheritedTotalsAttoRep: CarryTriple<CanonicalUintString>
	localTotalsAttoRep: CarryTriple<CanonicalUintString>
}

export interface CarryJournalCheckpointConsumptionDisposition {
	game: Address
	kind: 'inherited' | 'local'
	outcome: CarryOutcome
	parentDepositIndex: string
	reason: 0 | 1 | 2 | 3
	storageBasisAttoRep: CanonicalUintString
}

export interface CarryJournalClaimRetention {
	mantissa: CanonicalUintString
	exponent: string
	rootSourceGame: Address | null
}

export interface CarryJournalEventMmrWitness {
	leafIndex: string
	siblings: Hash[]
}

export interface CarryJournalEventMmrAccumulator {
	/** Number of canonical leaves committed in accumulator order. */
	leafCount: string
	/** Fixed height-indexed frontier; unoccupied heights are the literal zero hash. */
	peaks: Hash[]
	/** Domain-, identity-, and count-bound commitment to the complete canonical frontier. */
	root: Hash
}

export interface CarryJournalDirectClaimEvidence {
	claim: ClaimDepositJournalEvent
	claimWitness: CarryJournalEventMmrWitness
	consumption: CarryDepositConsumedJournalEvent
	consumptionWitness: CarryJournalEventMmrWitness
}

export interface CarryJournalCheckpointGame {
	directClaimBaselineAttoRep: CarryTriple<CanonicalUintString> | null
	game: Address
	pool: Address
	state: CarryGameState
	localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	source: { game: Address; pool: Address; snapshotId: Hash } | null
	haircut: { rebasedElapsed: string; repBeforeAttoRep: CanonicalUintString; repRemovedAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString } | null
	rawAccounting: CarryJournalRawAccounting | null
	claimRetention: CarryJournalClaimRetention
}

export interface CarryJournalCheckpointSourceSnapshot {
	directClaimBaselineAttoRep: CarryTriple<CanonicalUintString>
	snapshotId: Hash
	sourceGame: Address
	sourcePool: Address
	state: CarryGameState
}

export interface CarryProofJournalCheckpoint {
	schemaVersion: 3
	cutoff: CarryJournalCursor
	prefixEventCount: string
	prefixEventDigest: Hash
	prefixEventMmr: CarryJournalEventMmrAccumulator
	directClaimMmr: CarryJournalEventMmrAccumulator
	checkpointSnapshotCount: string
	games: CarryJournalCheckpointGame[]
	pendingSourceSnapshots: CarryJournalCheckpointSourceSnapshot[]
	consumptionDispositions: CarryJournalCheckpointConsumptionDisposition[]
	directClaimEvidence: CarryJournalDirectClaimEvidence[]
	forkSnapshotIds: Hash[]
	forkSnapshotPools: Address[]
	lastLocalNodeIds: Array<{ game: Address; nodeId: string }>
}

export interface CarryProofJournal {
	schemaVersion: 3
	chainId: number
	profileId: string
	scanStarted: boolean
	securityPoolForker: Address
	startBlock: string
	cursor: CarryJournalCursor
	checkpoint?: CarryProofJournalCheckpoint
	events: CarryProofJournalEvent[]
}

export interface CarryProofJournalIdentity {
	chainId: number
	profileId: string
	securityPoolForker: Address
	startBlock: string
	initialCursor: CarryJournalCursor
}

export interface CarryProofJournalExpectedIdentity {
	chainId: number
	profileId: string
	securityPoolForker: Address
	startBlock: string
}

export class CarryProofJournalIdentityMismatchError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'CarryProofJournalIdentityMismatchError'
	}
}

export interface CarryProofCandidate {
	claimSourceGame: Address
	game: Address
	pool: Address
	sourceGame: Address
	snapshotId: Hash
	outcome: CarryOutcome
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	sourceNodeId: string
	proof: CarriedDepositProof
}

export interface CarryProofCandidatePresence {
	claimSourceGame: Address
	game: Address
	pool: Address
	sourceGame: Address
	outcome: CarryOutcome
	parentDepositIndex: string
	sourceNodeId: string
}

export interface ReplayedCarryGame {
	game: Address
	pool: Address
	sourceGame?: Address
	snapshotId?: Hash
	state: CarryGameState
	/** Needed to deterministically separate haircut-exempt local REP from inherited REP. */
	localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	/** Exact pre-haircut storage buckets reconstructed at each canonical event. */
	rawAccounting: CarryJournalRawAccounting | null
}

export interface CarryProofReplayInstrumentation extends CarryProofAccumulatorInstrumentation {
	accumulatorCount: number
}

export interface CarryProofReplayResult {
	games: Record<string, ReplayedCarryGame>
	journalDigest: Hash
	proofCandidates: CarryProofCandidate[]
	proofCandidateCount: number
	proofCandidatePresence: CarryProofCandidatePresence[]
	directlyClaimedDeposits: Array<{ amountAttoRep: CanonicalUintString; sourceGame: Address; outcome: CarryOutcome; parentDepositIndex: string }>
	checkpointSnapshotCount: number
	instrumentation: CarryProofReplayInstrumentation
}

export type CarryJournalReorgAssessment = { resetRequired: false } | { resetRequired: true; resetFromBlock: string; reason: string }

interface JournalEnvelope {
	format: typeof JOURNAL_ENVELOPE_FORMAT
	checksum: Hash
	journal: CarryProofJournal
}

interface JournalSegmentDescriptor {
	file: string
	bytes: string
	checksum: Hash
}

interface SegmentedJournalEnvelope {
	format: typeof SEGMENTED_JOURNAL_ENVELOPE_FORMAT
	identity: CarryProofJournalExpectedIdentity
	manifestChecksum: Hash
	payloadBytes: string
	payloadChecksum: Hash
	residentRecords: string
	segmentCount: string
	segmentDirectory: string
	segments: JournalSegmentDescriptor[]
}

type SegmentedJournalManifestPayload = Omit<SegmentedJournalEnvelope, 'manifestChecksum'>

interface ReplayGameInternal {
	accumulator: CarryProofAccumulator
	game: Address
	directClaimBaselineAttoRep: CarryTriple<CanonicalUintString> | null
	haircut: { rebasedElapsed: string; repBeforeAttoRep: CanonicalUintString; repRemovedAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString } | null
	localUnresolvedTotalsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString]
	pool: Address
	rawAccounting: CarryJournalRawAccounting | null
	claimRetention: CarryJournalClaimRetention
	sourceGame?: Address
	snapshotId?: Hash
}

interface ReplayContext {
	forkSourceStateBySnapshotId: Map<string, { directClaimBaselineAttoRep: CarryTriple<CanonicalUintString>; sourceGame: Address; sourcePool: Address; state: CarryGameState }>
	checkpointSnapshotCount: number
	securityPoolForker: Address
}

interface ReplayDirectClaimEvidence {
	claim: ClaimDepositJournalEvent
	claimWitness?: CarryJournalEventMmrWitness
	consumption: CarryDepositConsumedJournalEvent
	consumptionWitness?: CarryJournalEventMmrWitness
}

interface ReplayWorkingSet {
	games: Map<string, ReplayGameInternal>
	continuationGamesBySourceGame: Map<string, Set<ReplayGameInternal>>
	consumptionDispositions: Map<string, CarryJournalCheckpointConsumptionDisposition>
	directClaimEvidence: Map<string, ReplayDirectClaimEvidence>
	directClaims: Map<string, { amountAttoRep: CanonicalUintString; sourceGame: Address; outcome: CarryOutcome; parentDepositIndex: string }>
	directClaimTotalsBySourceOutcome: Map<string, bigint>
	consumptionByClaimIdentity: Map<string, CarryDepositConsumedJournalEvent>
	drainByTransactionAndPool: Map<string, DisputeStakedRepDrainedJournalEvent>
	forkSnapshotIds: Set<string>
	forkSnapshotPools: Set<string>
	claimIdentities: Set<string>
	localNodeIdentities: Set<string>
	lastLocalNodeIdByGame: Map<string, bigint>
	derivedReplayCost: number
}

// One accumulator owns three outcomes, two indexed MMRs per outcome, and the
// lookup maps used by proof generation. Slot and nullifier weights account for
// the indexed nodes created from one serialized record; the nullifier depth is
// especially important because one consumed leaf expands into 65 tree nodes.
export const CARRY_PROOF_REPLAY_GAME_BASE_COST = 3 * (2 * CARRY_MMR_MAXIMUM_PEAKS + 32)
export const CARRY_PROOF_REPLAY_SLOT_COST = 6
export const CARRY_PROOF_REPLAY_NULLIFIER_COST = CARRY_NULLIFIER_DEPTH + 4

function checkedReplayCost(current: number, additional: number) {
	const next = current + additional
	if (!Number.isSafeInteger(next) || next > CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST) {
		throw new Error(`Carry proof journal indexed replay exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_REPLAY_COST.toString()}-unit safety limit`)
	}
	return next
}

function carryStateIndexedReplayCostFromUnknown(value: unknown, label: string) {
	const state = requiredRecord(value, label)
	const outcomes = residentArray(state, 'outcomes', label)
	if (outcomes.length !== 3) throw new Error(`${label}.outcomes must contain exactly three outcomes`)
	let cost = CARRY_PROOF_REPLAY_GAME_BASE_COST
	for (let outcome = 0; outcome < outcomes.length; outcome += 1) {
		const outcomeLabel = `${label}.outcomes[${outcome.toString()}]`
		const outcomeRecord = requiredRecord(outcomes[outcome], outcomeLabel)
		cost = checkedReplayCost(cost, CARRY_PROOF_REPLAY_SLOT_COST * residentArray(outcomeRecord, 'snapshotSlots', outcomeLabel).length)
		cost = checkedReplayCost(cost, CARRY_PROOF_REPLAY_SLOT_COST * residentArray(outcomeRecord, 'currentSlots', outcomeLabel).length)
		const nullifier = requiredRecord(outcomeRecord['nullifier'], `${outcomeLabel}.nullifier`)
		cost = checkedReplayCost(cost, CARRY_PROOF_REPLAY_NULLIFIER_COST * residentArray(nullifier, 'consumed', `${outcomeLabel}.nullifier`).length)
	}
	return cost
}

function preflightCheckpointIndexedReplay(value: unknown) {
	const checkpoint = requiredRecord(value, 'carry proof journal checkpoint')
	const games = residentArray(checkpoint, 'games', 'carry proof journal checkpoint')
	const snapshots = residentArray(checkpoint, 'pendingSourceSnapshots', 'carry proof journal checkpoint')
	const evidence = residentArray(checkpoint, 'directClaimEvidence', 'carry proof journal checkpoint')
	const eventMmr = requiredRecord(checkpoint['prefixEventMmr'], 'carry proof journal checkpoint.prefixEventMmr')
	const directClaimMmr = requiredRecord(checkpoint['directClaimMmr'], 'carry proof journal checkpoint.directClaimMmr')
	let cost = 0
	cost = checkedReplayCost(cost, residentArray(checkpoint, 'consumptionDispositions', 'carry proof journal checkpoint').length)
	cost = checkedReplayCost(cost, residentArray(eventMmr, 'peaks', 'carry proof journal checkpoint.prefixEventMmr').length)
	cost = checkedReplayCost(cost, residentArray(directClaimMmr, 'peaks', 'carry proof journal checkpoint.directClaimMmr').length)
	cost = checkedReplayCost(cost, evidence.length * 4)
	for (let index = 0; index < evidence.length; index += 1) {
		const entry = requiredRecord(evidence[index], `carry proof journal checkpoint.directClaimEvidence[${index.toString()}]`)
		const claimWitness = requiredRecord(entry['claimWitness'], `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].claimWitness`)
		const consumptionWitness = requiredRecord(entry['consumptionWitness'], `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].consumptionWitness`)
		cost = checkedReplayCost(cost, residentArray(claimWitness, 'siblings', `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].claimWitness`).length)
		cost = checkedReplayCost(cost, residentArray(consumptionWitness, 'siblings', `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].consumptionWitness`).length)
	}
	cost = checkedReplayCost(cost, residentArray(checkpoint, 'forkSnapshotIds', 'carry proof journal checkpoint').length)
	cost = checkedReplayCost(cost, residentArray(checkpoint, 'forkSnapshotPools', 'carry proof journal checkpoint').length)
	cost = checkedReplayCost(cost, residentArray(checkpoint, 'lastLocalNodeIds', 'carry proof journal checkpoint').length)
	for (let index = 0; index < games.length; index += 1) {
		const game = requiredRecord(games[index], `carry proof journal checkpoint.games[${index.toString()}]`)
		cost = checkedReplayCost(cost, carryStateIndexedReplayCostFromUnknown(game['state'], `carry proof journal checkpoint.games[${index.toString()}].state`))
		if (game['source'] !== null) cost = checkedReplayCost(cost, 1)
	}
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = requiredRecord(snapshots[index], `carry proof journal checkpoint.pendingSourceSnapshots[${index.toString()}]`)
		cost = checkedReplayCost(cost, carryStateIndexedReplayCostFromUnknown(snapshot['state'], `carry proof journal checkpoint.pendingSourceSnapshots[${index.toString()}].state`))
	}
}

function carryGameStateRecordCount(state: CarryGameState) {
	let count = 0
	for (const outcome of state.outcomes) count += outcome.snapshotSlots.length + outcome.currentSlots.length + outcome.nullifier.consumed.length
	return count
}

function carryAccumulatorReplayCost(state: CarryGameState) {
	let cost = CARRY_PROOF_REPLAY_GAME_BASE_COST
	for (const outcome of state.outcomes) cost += CARRY_PROOF_REPLAY_SLOT_COST * (outcome.snapshotSlots.length + outcome.currentSlots.length) + CARRY_PROOF_REPLAY_NULLIFIER_COST * outcome.nullifier.consumed.length
	return cost
}

function inheritedCarryAccumulatorReplayCost(state: CarryGameState) {
	let cost = CARRY_PROOF_REPLAY_GAME_BASE_COST
	for (const outcome of state.outcomes) cost += CARRY_PROOF_REPLAY_SLOT_COST * outcome.currentSlots.length * 2 + CARRY_PROOF_REPLAY_NULLIFIER_COST * outcome.nullifier.consumed.length
	return cost
}

function reserveDerivedReplayCost(working: ReplayWorkingSet, additional: number) {
	working.derivedReplayCost = checkedReplayCost(working.derivedReplayCost, additional)
}

function releaseDerivedReplayCost(working: ReplayWorkingSet, released: number) {
	if (!Number.isSafeInteger(released) || released < 0 || released > working.derivedReplayCost) throw new Error('Carry proof journal indexed replay cost release is invalid')
	working.derivedReplayCost -= released
}

function uintString(value: string, label: string) {
	if (!UINT_PATTERN.test(value)) throw new Error(`${label} must be a canonical unsigned decimal integer`)
	if (value.length > MAXIMUM_UINT256_DECIMAL.length || (value.length === MAXIMUM_UINT256_DECIMAL.length && value > MAXIMUM_UINT256_DECIMAL)) {
		throw new Error(`${label} exceeds uint256`)
	}
	const parsed = BigInt(value)
	return parsed
}

function positiveUint(value: string, label: string) {
	const parsed = uintString(value, label)
	if (parsed === 0n) throw new Error(`${label} must be positive`)
	return parsed
}

function hash(value: string, label: string): Hash {
	if (!HASH_PATTERN.test(value)) throw new Error(`${label} must be a 32-byte hash`)
	return toHex(BigInt(value), { size: 32 })
}

function address(value: string, label: string): Address {
	try {
		return getAddress(value)
	} catch (error) {
		throw new Error(`${label} must be an address`, { cause: error })
	}
}

function profileId(value: unknown, label: string) {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error(`${label} must be a nonempty string of at most 256 characters`)
	return value
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} must be an object`)
	return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function residentArray(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key]
	if (!Array.isArray(value)) throw new Error(`${label}.${key} must be an array`)
	return value
}

function addResidentRecords(current: number, additional: number, maximum = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS) {
	const next = current + additional
	if (!Number.isSafeInteger(next) || next > maximum) {
		throw new Error(`Carry proof journal exceeds its ${maximum.toString()}-record resident safety limit`)
	}
	return next
}

function carryStateResidentRecords(value: unknown, label: string, initial: number, maximum = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS) {
	const state = requiredRecord(value, label)
	const outcomes = residentArray(state, 'outcomes', label)
	if (outcomes.length !== 3) throw new Error(`${label}.outcomes must contain exactly three outcomes`)
	let count = initial
	for (let outcome = 0; outcome < outcomes.length; outcome += 1) {
		const outcomeRecord = requiredRecord(outcomes[outcome], `${label}.outcomes[${outcome.toString()}]`)
		count = addResidentRecords(count, residentArray(outcomeRecord, 'snapshotSlots', `${label}.outcomes[${outcome.toString()}]`).length, maximum)
		count = addResidentRecords(count, residentArray(outcomeRecord, 'currentSlots', `${label}.outcomes[${outcome.toString()}]`).length, maximum)
		const nullifier = requiredRecord(outcomeRecord['nullifier'], `${label}.outcomes[${outcome.toString()}].nullifier`)
		count = addResidentRecords(count, residentArray(nullifier, 'consumed', `${label}.outcomes[${outcome.toString()}].nullifier`).length, maximum)
	}
	return count
}

function checkpointResidentRecords(value: unknown, initial: number, maximum = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS) {
	if (value === undefined) return initial
	const checkpoint = requiredRecord(value, 'carry proof journal checkpoint')
	const games = residentArray(checkpoint, 'games', 'carry proof journal checkpoint')
	const snapshots = residentArray(checkpoint, 'pendingSourceSnapshots', 'carry proof journal checkpoint')
	const evidence = residentArray(checkpoint, 'directClaimEvidence', 'carry proof journal checkpoint')
	const eventMmr = requiredRecord(checkpoint['prefixEventMmr'], 'carry proof journal checkpoint.prefixEventMmr')
	const directClaimMmr = requiredRecord(checkpoint['directClaimMmr'], 'carry proof journal checkpoint.directClaimMmr')
	let count = addResidentRecords(initial, games.length, maximum)
	count = addResidentRecords(count, snapshots.length, maximum)
	count = addResidentRecords(count, residentArray(checkpoint, 'consumptionDispositions', 'carry proof journal checkpoint').length, maximum)
	count = addResidentRecords(count, residentArray(eventMmr, 'peaks', 'carry proof journal checkpoint.prefixEventMmr').length, maximum)
	count = addResidentRecords(count, residentArray(directClaimMmr, 'peaks', 'carry proof journal checkpoint.directClaimMmr').length, maximum)
	count = addResidentRecords(count, evidence.length * 4, maximum)
	for (let index = 0; index < evidence.length; index += 1) {
		const entry = requiredRecord(evidence[index], `carry proof journal checkpoint.directClaimEvidence[${index.toString()}]`)
		const claimWitness = requiredRecord(entry['claimWitness'], `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].claimWitness`)
		const consumptionWitness = requiredRecord(entry['consumptionWitness'], `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].consumptionWitness`)
		count = addResidentRecords(count, residentArray(claimWitness, 'siblings', `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].claimWitness`).length, maximum)
		count = addResidentRecords(count, residentArray(consumptionWitness, 'siblings', `carry proof journal checkpoint.directClaimEvidence[${index.toString()}].consumptionWitness`).length, maximum)
	}
	count = addResidentRecords(count, residentArray(checkpoint, 'forkSnapshotIds', 'carry proof journal checkpoint').length, maximum)
	count = addResidentRecords(count, residentArray(checkpoint, 'forkSnapshotPools', 'carry proof journal checkpoint').length, maximum)
	count = addResidentRecords(count, residentArray(checkpoint, 'lastLocalNodeIds', 'carry proof journal checkpoint').length, maximum)
	for (let index = 0; index < games.length; index += 1) {
		const game = requiredRecord(games[index], `carry proof journal checkpoint.games[${index.toString()}]`)
		count = carryStateResidentRecords(game['state'], `carry proof journal checkpoint.games[${index.toString()}].state`, count, maximum)
	}
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = requiredRecord(snapshots[index], `carry proof journal checkpoint.pendingSourceSnapshots[${index.toString()}]`)
		count = carryStateResidentRecords(snapshot['state'], `carry proof journal checkpoint.pendingSourceSnapshots[${index.toString()}].state`, count, maximum)
	}
	return count
}

function carryProofJournalResidentRecords(value: unknown, maximum = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS) {
	const journal = requiredRecord(value, 'carry proof journal')
	const events = residentArray(journal, 'events', 'carry proof journal')
	return checkpointResidentRecords(journal['checkpoint'], addResidentRecords(0, events.length, maximum), maximum)
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

function parseOutcome(value: unknown, label: string): CarryOutcome {
	if (value !== 0 && value !== 1 && value !== 2) throw new Error(`${label} must be Invalid, Yes, or No`)
	return value
}

function parseReason(value: unknown, label: string): 0 | 1 | 2 | 3 | 4 {
	if (value !== 0 && value !== 1 && value !== 2 && value !== 3 && value !== 4) throw new Error(`${label} must be a known carry-consumption reason`)
	return value
}

function parseHashTriple(value: unknown, label: string): CarryTriple<Hash> {
	if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain exactly three hashes`)
	if (typeof value[0] !== 'string' || typeof value[1] !== 'string' || typeof value[2] !== 'string') throw new Error(`${label} entries must be strings`)
	return [hash(value[0], `${label}[0]`), hash(value[1], `${label}[1]`), hash(value[2], `${label}[2]`)]
}

function parseUintTriple(value: unknown, label: string): CarryTriple<string> {
	if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain exactly three uint256 values`)
	if (typeof value[0] !== 'string' || typeof value[1] !== 'string' || typeof value[2] !== 'string') throw new Error(`${label} entries must be strings`)
	const first = value[0]
	const second = value[1]
	const third = value[2]
	uintString(first, `${label}[0]`)
	uintString(second, `${label}[1]`)
	uintString(third, `${label}[2]`)
	return [first, second, third]
}

function parsePosition(value: unknown, label: string): CarryJournalPosition {
	const position = requiredRecord(value, label)
	exactKeys(position, ['blockHash', 'blockNumber', 'logIndex', 'transactionHash', 'transactionIndex'], label)
	const blockNumber = stringField(position, 'blockNumber', label)
	const transactionIndex = stringField(position, 'transactionIndex', label)
	const logIndex = stringField(position, 'logIndex', label)
	uintString(blockNumber, `${label}.blockNumber`)
	uintString(transactionIndex, `${label}.transactionIndex`)
	uintString(logIndex, `${label}.logIndex`)
	return {
		blockHash: hash(stringField(position, 'blockHash', label), `${label}.blockHash`),
		blockNumber,
		logIndex,
		transactionHash: hash(stringField(position, 'transactionHash', label), `${label}.transactionHash`),
		transactionIndex,
	}
}

function parseEventBase(event: Record<string, unknown>, label: string) {
	return {
		emitter: address(stringField(event, 'emitter', label), `${label}.emitter`),
		pool: address(stringField(event, 'pool', label), `${label}.pool`),
		position: parsePosition(event['position'], `${label}.position`),
	}
}

function requireSignature(event: Record<string, unknown>, expected: string, label: string) {
	if (event['signature'] !== expected) throw new Error(`${label}.signature does not match ${String(event['kind'])}`)
}

function parseCarryProofJournalEvent(value: unknown, index: number): CarryProofJournalEvent {
	const label = `carry proof journal event ${index.toString()}`
	const event = requiredRecord(value, label)
	const kind = event['kind']
	if (kind === 'local-deposit-appended') {
		exactKeys(event, ['amountAttoRep', 'cumulativeAmountAttoRep', 'depositor', 'emitter', 'kind', 'nodeId', 'outcome', 'parentDepositIndex', 'pool', 'position', 'signature'], label)
		requireSignature(event, LOCAL_DEPOSIT_APPENDED_SIGNATURE, label)
		const nodeId = stringField(event, 'nodeId', label)
		const amountAttoRep = stringField(event, 'amountAttoRep', label)
		const parentDepositIndex = stringField(event, 'parentDepositIndex', label)
		const cumulativeAmountAttoRep = stringField(event, 'cumulativeAmountAttoRep', label)
		positiveUint(nodeId, `${label}.nodeId`)
		positiveUint(amountAttoRep, `${label}.amountAttoRep`)
		uintString(parentDepositIndex, `${label}.parentDepositIndex`)
		positiveUint(cumulativeAmountAttoRep, `${label}.cumulativeAmountAttoRep`)
		return {
			...parseEventBase(event, label),
			amountAttoRep,
			cumulativeAmountAttoRep,
			depositor: address(stringField(event, 'depositor', label), `${label}.depositor`),
			kind,
			nodeId,
			outcome: parseOutcome(event['outcome'], `${label}.outcome`),
			parentDepositIndex,
			signature: LOCAL_DEPOSIT_APPENDED_SIGNATURE,
		}
	}
	if (kind === 'fork-carry-checkpoint') {
		exactKeys(event, ['carryRoots', 'emitter', 'kind', 'leafCounts', 'nullifierRoots', 'pool', 'position', 'resolutionBalancesAttoRep', 'signature', 'snapshotId', 'sourceGame', 'sourcePool', 'unresolvedTotalsAttoRep'], label)
		requireSignature(event, FORK_CARRY_CHECKPOINT_SIGNATURE, label)
		return {
			...parseEventBase(event, label),
			carryRoots: parseHashTriple(event['carryRoots'], `${label}.carryRoots`),
			kind,
			leafCounts: parseUintTriple(event['leafCounts'], `${label}.leafCounts`),
			nullifierRoots: parseHashTriple(event['nullifierRoots'], `${label}.nullifierRoots`),
			resolutionBalancesAttoRep: parseUintTriple(event['resolutionBalancesAttoRep'], `${label}.resolutionBalancesAttoRep`),
			signature: FORK_CARRY_CHECKPOINT_SIGNATURE,
			snapshotId: hash(stringField(event, 'snapshotId', label), `${label}.snapshotId`),
			sourceGame: address(stringField(event, 'sourceGame', label), `${label}.sourceGame`),
			sourcePool: address(stringField(event, 'sourcePool', label), `${label}.sourcePool`),
			unresolvedTotalsAttoRep: parseUintTriple(event['unresolvedTotalsAttoRep'], `${label}.unresolvedTotalsAttoRep`),
		}
	}
	if (kind === 'carry-deposit-consumed') {
		exactKeys(event, ['amountAttoRep', 'depositor', 'emitter', 'kind', 'outcome', 'parentDepositIndex', 'pool', 'position', 'reason', 'resultingCarryRoot', 'resultingNullifierRoot', 'resultingUnresolvedTotalAttoRep', 'signature', 'sourceNodeId'], label)
		requireSignature(event, CARRY_DEPOSIT_CONSUMED_SIGNATURE, label)
		const amountAttoRep = stringField(event, 'amountAttoRep', label)
		const parentDepositIndex = stringField(event, 'parentDepositIndex', label)
		const sourceNodeId = stringField(event, 'sourceNodeId', label)
		const resultingUnresolvedTotalAttoRep = stringField(event, 'resultingUnresolvedTotalAttoRep', label)
		positiveUint(amountAttoRep, `${label}.amountAttoRep`)
		uintString(parentDepositIndex, `${label}.parentDepositIndex`)
		positiveUint(sourceNodeId, `${label}.sourceNodeId`)
		uintString(resultingUnresolvedTotalAttoRep, `${label}.resultingUnresolvedTotalAttoRep`)
		return {
			...parseEventBase(event, label),
			amountAttoRep,
			depositor: address(stringField(event, 'depositor', label), `${label}.depositor`),
			kind,
			outcome: parseOutcome(event['outcome'], `${label}.outcome`),
			parentDepositIndex,
			reason: parseReason(event['reason'], `${label}.reason`),
			resultingCarryRoot: hash(stringField(event, 'resultingCarryRoot', label), `${label}.resultingCarryRoot`),
			resultingNullifierRoot: hash(stringField(event, 'resultingNullifierRoot', label), `${label}.resultingNullifierRoot`),
			resultingUnresolvedTotalAttoRep,
			signature: CARRY_DEPOSIT_CONSUMED_SIGNATURE,
			sourceNodeId,
		}
	}
	if (kind === 'claim-deposit') {
		exactKeys(event, ['amountToWithdrawAttoRep', 'burnAmountAttoRep', 'depositor', 'emitter', 'kind', 'originalDepositAmountAttoRep', 'outcome', 'parentDepositIndex', 'pool', 'position', 'signature', 'transferredRep'], label)
		requireSignature(event, CLAIM_DEPOSIT_SIGNATURE, label)
		const parentDepositIndex = stringField(event, 'parentDepositIndex', label)
		const originalDepositAmountAttoRep = stringField(event, 'originalDepositAmountAttoRep', label)
		const amountToWithdrawAttoRep = stringField(event, 'amountToWithdrawAttoRep', label)
		const burnAmountAttoRep = stringField(event, 'burnAmountAttoRep', label)
		uintString(parentDepositIndex, `${label}.parentDepositIndex`)
		positiveUint(originalDepositAmountAttoRep, `${label}.originalDepositAmountAttoRep`)
		uintString(amountToWithdrawAttoRep, `${label}.amountToWithdrawAttoRep`)
		uintString(burnAmountAttoRep, `${label}.burnAmountAttoRep`)
		return {
			...parseEventBase(event, label),
			amountToWithdrawAttoRep,
			burnAmountAttoRep,
			depositor: address(stringField(event, 'depositor', label), `${label}.depositor`),
			kind,
			originalDepositAmountAttoRep,
			outcome: parseOutcome(event['outcome'], `${label}.outcome`),
			parentDepositIndex,
			signature: CLAIM_DEPOSIT_SIGNATURE,
			transferredRep: booleanField(event, 'transferredRep', label),
		}
	}
	if (kind === 'truth-auction-haircut') {
		exactKeys(event, ['emitter', 'kind', 'pool', 'position', 'rebasedElapsed', 'repBeforeAttoRep', 'repRemainingAttoRep', 'repRemovedAttoRep', 'resultingResolutionBalancesAttoRep', 'resultingUnresolvedTotalsAttoRep', 'signature'], label)
		requireSignature(event, TRUTH_AUCTION_HAIRCUT_SIGNATURE, label)
		const repBeforeAttoRep = stringField(event, 'repBeforeAttoRep', label)
		const repRemovedAttoRep = stringField(event, 'repRemovedAttoRep', label)
		const repRemainingAttoRep = stringField(event, 'repRemainingAttoRep', label)
		const rebasedElapsed = stringField(event, 'rebasedElapsed', label)
		positiveUint(repBeforeAttoRep, `${label}.repBeforeAttoRep`)
		positiveUint(repRemovedAttoRep, `${label}.repRemovedAttoRep`)
		positiveUint(repRemainingAttoRep, `${label}.repRemainingAttoRep`)
		uintString(rebasedElapsed, `${label}.rebasedElapsed`)
		if (BigInt(repRemovedAttoRep) + BigInt(repRemainingAttoRep) !== BigInt(repBeforeAttoRep)) throw new Error(`${label} REP haircut arithmetic is inconsistent`)
		return {
			...parseEventBase(event, label),
			kind,
			rebasedElapsed,
			repBeforeAttoRep,
			repRemainingAttoRep,
			repRemovedAttoRep,
			resultingResolutionBalancesAttoRep: parseUintTriple(event['resultingResolutionBalancesAttoRep'], `${label}.resultingResolutionBalancesAttoRep`),
			resultingUnresolvedTotalsAttoRep: parseUintTriple(event['resultingUnresolvedTotalsAttoRep'], `${label}.resultingUnresolvedTotalsAttoRep`),
			signature: TRUTH_AUCTION_HAIRCUT_SIGNATURE,
		}
	}
	if (kind === 'dispute-staked-rep-drained-at-fork') {
		exactKeys(event, ['amountAttoRep', 'emitter', 'kind', 'pool', 'position', 'signature', 'sourceGame'], label)
		requireSignature(event, DISPUTE_STAKED_REP_DRAINED_SIGNATURE, label)
		const amountAttoRep = stringField(event, 'amountAttoRep', label)
		uintString(amountAttoRep, `${label}.amountAttoRep`)
		return {
			...parseEventBase(event, label),
			amountAttoRep,
			kind,
			signature: DISPUTE_STAKED_REP_DRAINED_SIGNATURE,
			sourceGame: address(stringField(event, 'sourceGame', label), `${label}.sourceGame`),
		}
	}
	if (kind === 'security-pool-fork-snapshot') {
		exactKeys(
			event,
			[
				'auctionableAttoRepAtFork',
				'emitter',
				'escalationChildRepAtForkAttoRep',
				'escalationElapsedAtFork',
				'escalationNonDecisionThresholdAtForkAttoRep',
				'escalationSnapshotId',
				'escalationSourceRepAtForkAttoRep',
				'escalationStartBondAtForkAttoRep',
				'kind',
				'migrationProxy',
				'ownFork',
				'pool',
				'position',
				'settlementCollateralAtForkAttoEth',
				'signature',
				'totalPoolHeldRepAtForkAttoRep',
				'unresolvedEscalation',
			],
			label,
		)
		requireSignature(event, SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE, label)
		const uintFields = {
			auctionableAttoRepAtFork: stringField(event, 'auctionableAttoRepAtFork', label),
			escalationChildRepAtForkAttoRep: stringField(event, 'escalationChildRepAtForkAttoRep', label),
			escalationElapsedAtFork: stringField(event, 'escalationElapsedAtFork', label),
			escalationNonDecisionThresholdAtForkAttoRep: stringField(event, 'escalationNonDecisionThresholdAtForkAttoRep', label),
			escalationSourceRepAtForkAttoRep: stringField(event, 'escalationSourceRepAtForkAttoRep', label),
			escalationStartBondAtForkAttoRep: stringField(event, 'escalationStartBondAtForkAttoRep', label),
			settlementCollateralAtForkAttoEth: stringField(event, 'settlementCollateralAtForkAttoEth', label),
			totalPoolHeldRepAtForkAttoRep: stringField(event, 'totalPoolHeldRepAtForkAttoRep', label),
		}
		uintString(uintFields.auctionableAttoRepAtFork, `${label}.auctionableAttoRepAtFork`)
		uintString(uintFields.escalationChildRepAtForkAttoRep, `${label}.escalationChildRepAtForkAttoRep`)
		uintString(uintFields.escalationElapsedAtFork, `${label}.escalationElapsedAtFork`)
		uintString(uintFields.escalationNonDecisionThresholdAtForkAttoRep, `${label}.escalationNonDecisionThresholdAtForkAttoRep`)
		uintString(uintFields.escalationSourceRepAtForkAttoRep, `${label}.escalationSourceRepAtForkAttoRep`)
		uintString(uintFields.escalationStartBondAtForkAttoRep, `${label}.escalationStartBondAtForkAttoRep`)
		uintString(uintFields.settlementCollateralAtForkAttoEth, `${label}.settlementCollateralAtForkAttoEth`)
		uintString(uintFields.totalPoolHeldRepAtForkAttoRep, `${label}.totalPoolHeldRepAtForkAttoRep`)
		return {
			...parseEventBase(event, label),
			...uintFields,
			escalationSnapshotId: hash(stringField(event, 'escalationSnapshotId', label), `${label}.escalationSnapshotId`),
			kind,
			migrationProxy: address(stringField(event, 'migrationProxy', label), `${label}.migrationProxy`),
			ownFork: booleanField(event, 'ownFork', label),
			signature: SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE,
			unresolvedEscalation: booleanField(event, 'unresolvedEscalation', label),
		}
	}
	throw new Error(`${label}.kind is unsupported`)
}

function comparePositions(left: CarryJournalPosition, right: CarryJournalPosition) {
	const blockComparison = BigInt(left.blockNumber) - BigInt(right.blockNumber)
	if (blockComparison !== 0n) return blockComparison < 0n ? -1 : 1
	const transactionComparison = BigInt(left.transactionIndex) - BigInt(right.transactionIndex)
	if (transactionComparison !== 0n) return transactionComparison < 0n ? -1 : 1
	const logComparison = BigInt(left.logIndex) - BigInt(right.logIndex)
	if (logComparison !== 0n) return logComparison < 0n ? -1 : 1
	return 0
}

function nullableRecord(value: unknown, label: string) {
	if (value === null) return null
	return requiredRecord(value, label)
}

function parseCheckpointRawAccounting(value: unknown, label: string): CarryJournalRawAccounting | null {
	const record = nullableRecord(value, label)
	if (record === null) return null
	exactKeys(record, ['inheritedTotalsAttoRep', 'localTotalsAttoRep'], label)
	return {
		inheritedTotalsAttoRep: parseUintTriple(record['inheritedTotalsAttoRep'], `${label}.inheritedTotalsAttoRep`),
		localTotalsAttoRep: parseUintTriple(record['localTotalsAttoRep'], `${label}.localTotalsAttoRep`),
	}
}

function parseCheckpointClaimRetention(value: unknown, label: string): CarryJournalClaimRetention {
	const record = requiredRecord(value, label)
	exactKeys(record, ['exponent', 'mantissa', 'rootSourceGame'], label)
	const exponent = stringField(record, 'exponent', label)
	const mantissa = stringField(record, 'mantissa', label)
	uintString(exponent, `${label}.exponent`)
	const parsedMantissa = positiveUint(mantissa, `${label}.mantissa`)
	if (parsedMantissa < INITIAL_CLAIM_RETENTION_MANTISSA) throw new Error(`${label}.mantissa is not normalized`)
	const rootSourceValue = record['rootSourceGame']
	if (rootSourceValue !== null && typeof rootSourceValue !== 'string') throw new Error(`${label}.rootSourceGame must be an address or null`)
	return {
		exponent,
		mantissa,
		rootSourceGame: rootSourceValue === null ? null : address(rootSourceValue, `${label}.rootSourceGame`),
	}
}

function checkpointLocalSlotTotals(game: Address, state: CarryGameState, label: string): CarryTriple<string> {
	const totals: [string, string, string] = ['0', '0', '0']
	for (const outcome of [0, 1, 2] as const) {
		const outcomeState = state.outcomes[outcome]
		const snapshotParents = new Set(outcomeState.snapshotSlots.map(slot => slot.leaf.parentDepositIndex))
		if (outcomeState.nullifier.consumed.some(entry => !snapshotParents.has(entry.parentDepositIndex))) throw new Error(`${label} outcome ${outcome.toString()} nullifies a deposit outside its inherited snapshot`)
		for (const [slotIndex, snapshotSlot] of outcomeState.snapshotSlots.entries()) {
			if (snapshotSlot.originGame.toLowerCase() === game.toLowerCase()) throw new Error(`${label} outcome ${outcome.toString()} snapshot slot ${slotIndex.toString()} is target-local`)
			const currentSlot = outcomeState.currentSlots[slotIndex]
			if (currentSlot === undefined || stableJson(currentSlot, `${label} current slot`) !== stableJson(snapshotSlot, `${label} snapshot slot`)) {
				throw new Error(`${label} outcome ${outcome.toString()} snapshot does not match the current-slot prefix`)
			}
		}
		let localTotal = 0n
		for (let slotIndex = outcomeState.snapshotSlots.length; slotIndex < outcomeState.currentSlots.length; slotIndex += 1) {
			const slot = outcomeState.currentSlots[slotIndex]
			if (slot === undefined) throw new Error(`${label} outcome ${outcome.toString()} has a missing current slot`)
			if (slot.originGame.toLowerCase() !== game.toLowerCase()) throw new Error(`${label} outcome ${outcome.toString()} appended slot is not target-local`)
			if (!slot.consumedLocally) localTotal += BigInt(slot.leaf.amountAttoRep)
		}
		totals[outcome] = localTotal.toString()
	}
	return totals
}

function parseCheckpointGame(value: unknown, index: number): CarryJournalCheckpointGame {
	const label = `carry proof journal checkpoint game ${index.toString()}`
	const record = requiredRecord(value, label)
	exactKeys(record, ['claimRetention', 'directClaimBaselineAttoRep', 'game', 'haircut', 'localUnresolvedTotalsAttoRep', 'pool', 'rawAccounting', 'source', 'state'], label)
	const sourceRecord = nullableRecord(record['source'], `${label}.source`)
	const source =
		sourceRecord === null
			? null
			: (() => {
					exactKeys(sourceRecord, ['game', 'pool', 'snapshotId'], `${label}.source`)
					return {
						game: address(stringField(sourceRecord, 'game', `${label}.source`), `${label}.source.game`),
						pool: address(stringField(sourceRecord, 'pool', `${label}.source`), `${label}.source.pool`),
						snapshotId: hash(stringField(sourceRecord, 'snapshotId', `${label}.source`), `${label}.source.snapshotId`),
					}
				})()
	const haircutRecord = nullableRecord(record['haircut'], `${label}.haircut`)
	const haircut =
		haircutRecord === null
			? null
			: (() => {
					exactKeys(haircutRecord, ['rebasedElapsed', 'repBeforeAttoRep', 'repRemainingAttoRep', 'repRemovedAttoRep'], `${label}.haircut`)
					const rebasedElapsed = stringField(haircutRecord, 'rebasedElapsed', `${label}.haircut`)
					const repBeforeAttoRep = stringField(haircutRecord, 'repBeforeAttoRep', `${label}.haircut`)
					const repRemovedAttoRep = stringField(haircutRecord, 'repRemovedAttoRep', `${label}.haircut`)
					const repRemainingAttoRep = stringField(haircutRecord, 'repRemainingAttoRep', `${label}.haircut`)
					uintString(rebasedElapsed, `${label}.haircut.rebasedElapsed`)
					const before = positiveUint(repBeforeAttoRep, `${label}.haircut.repBeforeAttoRep`)
					const removed = positiveUint(repRemovedAttoRep, `${label}.haircut.repRemovedAttoRep`)
					const remaining = positiveUint(repRemainingAttoRep, `${label}.haircut.repRemainingAttoRep`)
					if (removed + remaining !== before) throw new Error(`${label}.haircut REP accounting is inconsistent`)
					return { rebasedElapsed, repBeforeAttoRep, repRemainingAttoRep, repRemovedAttoRep }
				})()
	const rawAccounting = parseCheckpointRawAccounting(record['rawAccounting'], `${label}.rawAccounting`)
	if ((source === null) !== (rawAccounting === null)) throw new Error(`${label} raw accounting must exist exactly for inherited carry games`)
	const directClaimBaselineAttoRep = record['directClaimBaselineAttoRep'] === null ? null : parseUintTriple(record['directClaimBaselineAttoRep'], `${label}.directClaimBaselineAttoRep`)
	if ((source === null) !== (directClaimBaselineAttoRep === null)) throw new Error(`${label} direct-claim baseline must exist exactly for inherited carry games`)
	const claimRetention = parseCheckpointClaimRetention(record['claimRetention'], `${label}.claimRetention`)
	if ((source === null) !== (claimRetention.rootSourceGame === null)) throw new Error(`${label} claim-retention root must exist exactly for inherited carry games`)
	const game = address(stringField(record, 'game', label), `${label}.game`)
	const localUnresolvedTotalsAttoRep = parseUintTriple(record['localUnresolvedTotalsAttoRep'], `${label}.localUnresolvedTotalsAttoRep`)
	const state = parseCarryGameState(record['state'], `${label}.state`)
	const localSlotTotals = checkpointLocalSlotTotals(game, state, `${label}.state`)
	if (source === null) {
		for (const outcome of [0, 1, 2] as const) {
			if (localSlotTotals[outcome] !== localUnresolvedTotalsAttoRep[outcome]) throw new Error(`${label}.localUnresolvedTotalsAttoRep does not match outcome ${outcome.toString()} local slots`)
		}
	}
	return {
		claimRetention,
		directClaimBaselineAttoRep,
		game,
		haircut,
		localUnresolvedTotalsAttoRep,
		pool: address(stringField(record, 'pool', label), `${label}.pool`),
		rawAccounting,
		source,
		state,
	}
}

function parseCheckpointSourceSnapshot(value: unknown, index: number): CarryJournalCheckpointSourceSnapshot {
	const label = `carry proof journal checkpoint source snapshot ${index.toString()}`
	const record = requiredRecord(value, label)
	exactKeys(record, ['directClaimBaselineAttoRep', 'snapshotId', 'sourceGame', 'sourcePool', 'state'], label)
	const sourceGame = address(stringField(record, 'sourceGame', label), `${label}.sourceGame`)
	const state = parseCarryGameState(record['state'], `${label}.state`)
	checkpointLocalSlotTotals(sourceGame, state, `${label}.state`)
	const snapshotId = hash(stringField(record, 'snapshotId', label), `${label}.snapshotId`)
	const invalidCommitment = carryCommitment(state.outcomes[0].currentSlots)
	const noCommitment = carryCommitment(state.outcomes[1].currentSlots)
	const yesCommitment = carryCommitment(state.outcomes[2].currentSlots)
	const accounting = carryGameAccounting(state)
	const expectedSnapshotId = carryCheckpointSnapshotId({
		carryRoots: [invalidCommitment.root, noCommitment.root, yesCommitment.root],
		leafCounts: [invalidCommitment.leafCount, noCommitment.leafCount, yesCommitment.leafCount],
		nullifierRoots: [sparseNullifierRoot(state.outcomes[0].nullifier), sparseNullifierRoot(state.outcomes[1].nullifier), sparseNullifierRoot(state.outcomes[2].nullifier)],
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		sourceGame,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	})
	if (snapshotId.toLowerCase() !== expectedSnapshotId.toLowerCase()) throw new Error(`${label}.snapshotId does not match its persisted source carry state`)
	return {
		directClaimBaselineAttoRep: parseUintTriple(record['directClaimBaselineAttoRep'], `${label}.directClaimBaselineAttoRep`),
		snapshotId,
		sourceGame,
		sourcePool: address(stringField(record, 'sourcePool', label), `${label}.sourcePool`),
		state,
	}
}

const CARRY_EVENT_MMR_MAXIMUM_LEAVES = 1n << BigInt(CARRY_MMR_MAXIMUM_PEAKS)

function eventMmrLeafHash(identity: CarryProofJournalExpectedIdentity, leafIndex: bigint, event: CarryProofJournalEvent) {
	return keccak256(toHex(stableJson({ domain: CARRY_EVENT_MMR_LEAF_DOMAIN, event, identity, leafIndex: leafIndex.toString() }, 'Carry event MMR leaf')))
}

function eventMmrParentHash(left: Hash, right: Hash) {
	return keccak256(toHex(stableJson({ domain: CARRY_EVENT_MMR_PARENT_DOMAIN, left, right }, 'Carry event MMR parent')))
}

function eventMmrRoot(identity: CarryProofJournalExpectedIdentity, leafCount: bigint, peaks: readonly Hash[]) {
	if (leafCount < 0n || leafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES) throw new Error('Carry event MMR leaf count is outside its capacity')
	if (peaks.length !== CARRY_MMR_MAXIMUM_PEAKS) throw new Error(`Carry event MMR must contain exactly ${CARRY_MMR_MAXIMUM_PEAKS.toString()} canonical peaks`)
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		const peak = peaks[height]
		if (peak === undefined) throw new Error(`Carry event MMR peak ${height.toString()} is missing`)
		const occupied = ((leafCount >> BigInt(height)) & 1n) === 1n
		if (!occupied && peak !== zeroHash) throw new Error(`Carry event MMR unoccupied peak ${height.toString()} is nonzero`)
		if (occupied && peak === zeroHash) throw new Error(`Carry event MMR occupied peak ${height.toString()} is zero`)
	}
	return keccak256(toHex(stableJson({ domain: CARRY_EVENT_MMR_ROOT_DOMAIN, identity, leafCount: leafCount.toString(), peaks }, 'Carry event MMR root')))
}

function emptyEventMmrAccumulator(identity: CarryProofJournalExpectedIdentity): CarryJournalEventMmrAccumulator {
	const peaks = Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => zeroHash)
	return { leafCount: '0', peaks, root: eventMmrRoot(identity, 0n, peaks) }
}

function parseEventMmrAccumulator(value: unknown, label: string, identity: CarryProofJournalExpectedIdentity): CarryJournalEventMmrAccumulator {
	const record = requiredRecord(value, label)
	exactKeys(record, ['leafCount', 'peaks', 'root'], label)
	const leafCount = stringField(record, 'leafCount', label)
	const parsedLeafCount = uintString(leafCount, `${label}.leafCount`)
	if (parsedLeafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES) throw new Error(`${label}.leafCount exceeds the event MMR capacity`)
	const peaksValue = record['peaks']
	if (!Array.isArray(peaksValue) || peaksValue.length !== CARRY_MMR_MAXIMUM_PEAKS) {
		throw new Error(`${label}.peaks must contain exactly ${CARRY_MMR_MAXIMUM_PEAKS.toString()} hashes`)
	}
	const peaks = peaksValue.map((peak, index) => {
		if (typeof peak !== 'string') throw new Error(`${label}.peaks[${index.toString()}] must be a hash`)
		return hash(peak, `${label}.peaks[${index.toString()}]`)
	})
	const root = hash(stringField(record, 'root', label), `${label}.root`)
	if (eventMmrRoot(identity, parsedLeafCount, peaks).toLowerCase() !== root.toLowerCase()) throw new Error(`${label}.root does not commit to its identity, count, and canonical peaks`)
	return { leafCount, peaks, root }
}

function parseEventMmrWitness(value: unknown, label: string): CarryJournalEventMmrWitness {
	const record = requiredRecord(value, label)
	exactKeys(record, ['leafIndex', 'siblings'], label)
	const leafIndex = stringField(record, 'leafIndex', label)
	uintString(leafIndex, `${label}.leafIndex`)
	const siblingsValue = record['siblings']
	if (!Array.isArray(siblingsValue) || siblingsValue.length >= CARRY_MMR_MAXIMUM_PEAKS) throw new Error(`${label}.siblings exceeds the event MMR path capacity`)
	const siblings = siblingsValue.map((sibling, index) => {
		if (typeof sibling !== 'string') throw new Error(`${label}.siblings[${index.toString()}] must be a hash`)
		return hash(sibling, `${label}.siblings[${index.toString()}]`)
	})
	return { leafIndex, siblings }
}

function eventMmrPeakForLeaf(leafCount: bigint, globalLeafIndex: bigint) {
	if (leafCount <= 0n || globalLeafIndex < 0n || globalLeafIndex >= leafCount) throw new Error('Carry event MMR witness leaf index is outside the committed prefix')
	let peakStartIndex = 0n
	for (let height = CARRY_MMR_MAXIMUM_PEAKS - 1; height >= 0; height -= 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const nextPeakStartIndex = peakStartIndex + (1n << BigInt(height))
		if (globalLeafIndex < nextPeakStartIndex) return { height, relativeLeafIndex: globalLeafIndex - peakStartIndex }
		peakStartIndex = nextPeakStartIndex
	}
	throw new Error('Carry event MMR witness has no occupied peak')
}

function verifyEventMmrWitness(identity: CarryProofJournalExpectedIdentity, event: CarryProofJournalEvent, witness: CarryJournalEventMmrWitness, accumulator: CarryJournalEventMmrAccumulator, label: string) {
	const leafIndex = uintString(witness.leafIndex, `${label}.leafIndex`)
	const selected = eventMmrPeakForLeaf(BigInt(accumulator.leafCount), leafIndex)
	if (witness.siblings.length !== selected.height) throw new Error(`${label}.siblings does not match its committed event MMR peak height`)
	let node = eventMmrLeafHash(identity, leafIndex, event)
	for (let height = 0; height < selected.height; height += 1) {
		const sibling = witness.siblings[height]
		if (sibling === undefined) throw new Error(`${label}.siblings[${height.toString()}] is missing`)
		node = ((selected.relativeLeafIndex >> BigInt(height)) & 1n) === 0n ? eventMmrParentHash(node, sibling) : eventMmrParentHash(sibling, node)
	}
	const peak = accumulator.peaks[selected.height]
	if (peak === undefined || node.toLowerCase() !== peak.toLowerCase()) throw new Error(`${label} does not prove canonical prefix inclusion`)
}

function directClaimMmrLeafHash(identity: CarryProofJournalExpectedIdentity, directClaimIndex: bigint, evidence: CarryJournalDirectClaimEvidence) {
	return keccak256(
		toHex(
			stableJson(
				{
					claim: evidence.claim,
					claimEventIndex: evidence.claimWitness.leafIndex,
					consumption: evidence.consumption,
					consumptionEventIndex: evidence.consumptionWitness.leafIndex,
					directClaimIndex: directClaimIndex.toString(),
					domain: CARRY_DIRECT_CLAIM_MMR_LEAF_DOMAIN,
					identity,
				},
				'Carry direct-claim MMR leaf',
			),
		),
	)
}

function directClaimMmrParentHash(left: Hash, right: Hash) {
	return keccak256(toHex(stableJson({ domain: CARRY_DIRECT_CLAIM_MMR_PARENT_DOMAIN, left, right }, 'Carry direct-claim MMR parent')))
}

function directClaimMmrRoot(identity: CarryProofJournalExpectedIdentity, leafCount: bigint, peaks: readonly Hash[]) {
	if (leafCount < 0n || leafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES) throw new Error('Carry direct-claim MMR leaf count is outside its capacity')
	if (peaks.length !== CARRY_MMR_MAXIMUM_PEAKS) throw new Error(`Carry direct-claim MMR must contain exactly ${CARRY_MMR_MAXIMUM_PEAKS.toString()} canonical peaks`)
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		const peak = peaks[height]
		if (peak === undefined) throw new Error(`Carry direct-claim MMR peak ${height.toString()} is missing`)
		const occupied = ((leafCount >> BigInt(height)) & 1n) === 1n
		if (!occupied && peak !== zeroHash) throw new Error(`Carry direct-claim MMR unoccupied peak ${height.toString()} is nonzero`)
		if (occupied && peak === zeroHash) throw new Error(`Carry direct-claim MMR occupied peak ${height.toString()} is zero`)
	}
	return keccak256(toHex(stableJson({ domain: CARRY_DIRECT_CLAIM_MMR_ROOT_DOMAIN, identity, leafCount: leafCount.toString(), peaks }, 'Carry direct-claim MMR root')))
}

function parseDirectClaimMmrAccumulator(value: unknown, label: string, identity: CarryProofJournalExpectedIdentity): CarryJournalEventMmrAccumulator {
	const record = requiredRecord(value, label)
	exactKeys(record, ['leafCount', 'peaks', 'root'], label)
	const leafCount = stringField(record, 'leafCount', label)
	const parsedLeafCount = uintString(leafCount, `${label}.leafCount`)
	if (parsedLeafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES) throw new Error(`${label}.leafCount exceeds the direct-claim MMR capacity`)
	const peaksValue = record['peaks']
	if (!Array.isArray(peaksValue) || peaksValue.length !== CARRY_MMR_MAXIMUM_PEAKS) {
		throw new Error(`${label}.peaks must contain exactly ${CARRY_MMR_MAXIMUM_PEAKS.toString()} hashes`)
	}
	const peaks = peaksValue.map((peak, index) => {
		if (typeof peak !== 'string') throw new Error(`${label}.peaks[${index.toString()}] must be a hash`)
		return hash(peak, `${label}.peaks[${index.toString()}]`)
	})
	const root = hash(stringField(record, 'root', label), `${label}.root`)
	if (directClaimMmrRoot(identity, parsedLeafCount, peaks).toLowerCase() !== root.toLowerCase()) throw new Error(`${label}.root does not commit to its identity, count, and canonical peaks`)
	return { leafCount, peaks, root }
}

function buildDirectClaimMmr(identity: CarryProofJournalExpectedIdentity, evidence: readonly CarryJournalDirectClaimEvidence[]): CarryJournalEventMmrAccumulator {
	const orderedEvidence = [...evidence].sort((left, right) => {
		const leftIndex = BigInt(left.claimWitness.leafIndex)
		const rightIndex = BigInt(right.claimWitness.leafIndex)
		if (leftIndex < rightIndex) return -1
		if (leftIndex > rightIndex) return 1
		return 0
	})
	const peaks: Array<Hash | undefined> = Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => undefined)
	let leafCount = 0n
	let previousClaimEventIndex: bigint | undefined
	for (const entry of orderedEvidence) {
		const claimEventIndex = BigInt(entry.claimWitness.leafIndex)
		if (previousClaimEventIndex !== undefined && claimEventIndex <= previousClaimEventIndex) throw new Error('Carry direct-claim MMR evidence is not in strict canonical event order')
		previousClaimEventIndex = claimEventIndex
		if (leafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES - 1n) throw new Error('Carry direct-claim MMR exceeds its leaf capacity')
		let node = directClaimMmrLeafHash(identity, leafCount, entry)
		let height = 0
		while (((leafCount >> BigInt(height)) & 1n) === 1n) {
			const left = peaks[height]
			if (left === undefined) throw new Error(`Carry direct-claim MMR peak ${height.toString()} is missing during append`)
			node = directClaimMmrParentHash(left, node)
			peaks[height] = undefined
			height += 1
		}
		if (height >= CARRY_MMR_MAXIMUM_PEAKS) throw new Error('Carry direct-claim MMR is too tall')
		peaks[height] = node
		leafCount += 1n
	}
	const canonicalPeaks = peaks.map(peak => peak ?? zeroHash)
	return {
		leafCount: leafCount.toString(),
		peaks: canonicalPeaks,
		root: directClaimMmrRoot(identity, leafCount, canonicalPeaks),
	}
}

function prefixEventCommitment(identity: CarryProofJournalExpectedIdentity, eventMmr: CarryJournalEventMmrAccumulator, directClaimMmr: CarryJournalEventMmrAccumulator) {
	return keccak256(
		toHex(
			stableJson(
				{
					directClaimMmr: { leafCount: directClaimMmr.leafCount, root: directClaimMmr.root },
					domain: CARRY_PREFIX_COMMITMENT_DOMAIN,
					eventMmr: { leafCount: eventMmr.leafCount, root: eventMmr.root },
					identity,
				},
				'Carry prefix commitment',
			),
		),
	)
}

function directClaimFromEvidence(evidence: Pick<CarryJournalDirectClaimEvidence, 'claim'>) {
	return {
		amountAttoRep: evidence.claim.originalDepositAmountAttoRep,
		outcome: evidence.claim.outcome,
		parentDepositIndex: evidence.claim.parentDepositIndex,
		sourceGame: evidence.claim.emitter,
	}
}

function parseDirectClaimEvidence(value: unknown, index: number): CarryJournalDirectClaimEvidence {
	const label = `carry proof journal checkpoint direct-claim evidence ${index.toString()}`
	const record = requiredRecord(value, label)
	exactKeys(record, ['claim', 'claimWitness', 'consumption', 'consumptionWitness'], label)
	const parsedConsumption = parseCarryProofJournalEvent(record['consumption'], index * 2)
	const parsedClaim = parseCarryProofJournalEvent(record['claim'], index * 2 + 1)
	if (parsedConsumption.kind !== 'carry-deposit-consumed') throw new Error(`${label}.consumption must be a CarryDepositConsumed event`)
	if (parsedClaim.kind !== 'claim-deposit') throw new Error(`${label}.claim must be a ClaimDeposit event`)
	if (
		parsedConsumption.position.blockNumber !== parsedClaim.position.blockNumber ||
		parsedConsumption.position.blockHash.toLowerCase() !== parsedClaim.position.blockHash.toLowerCase() ||
		parsedConsumption.position.transactionHash.toLowerCase() !== parsedClaim.position.transactionHash.toLowerCase() ||
		parsedConsumption.position.transactionIndex !== parsedClaim.position.transactionIndex ||
		comparePositions(parsedConsumption.position, parsedClaim.position) >= 0
	) {
		throw new Error(`${label} events are not an ordered same-transaction canonical pair`)
	}
	if (
		parsedConsumption.emitter.toLowerCase() !== parsedClaim.emitter.toLowerCase() ||
		parsedConsumption.pool.toLowerCase() !== parsedClaim.pool.toLowerCase() ||
		parsedConsumption.depositor.toLowerCase() !== parsedClaim.depositor.toLowerCase() ||
		parsedConsumption.outcome !== parsedClaim.outcome ||
		parsedConsumption.parentDepositIndex !== parsedClaim.parentDepositIndex ||
		parsedConsumption.amountAttoRep !== parsedClaim.originalDepositAmountAttoRep
	) {
		throw new Error(`${label} ClaimDeposit does not match its CarryDepositConsumed event`)
	}
	if (parsedConsumption.reason !== 3 || parsedClaim.transferredRep) throw new Error(`${label} does not prove a direct parent ClaimDeposit`)
	return {
		claim: parsedClaim,
		claimWitness: parseEventMmrWitness(record['claimWitness'], `${label}.claimWitness`),
		consumption: parsedConsumption,
		consumptionWitness: parseEventMmrWitness(record['consumptionWitness'], `${label}.consumptionWitness`),
	}
}

function parseCheckpoint(value: unknown, identity: CarryProofJournalExpectedIdentity): CarryProofJournalCheckpoint {
	const label = 'carry proof journal checkpoint'
	checkpointResidentRecords(value, 0)
	// Reject a serialized state whose derived indexes would exceed the replay
	// envelope before parseCarryGameState constructs any MMR/nullifier maps.
	preflightCheckpointIndexedReplay(value)
	const record = requiredRecord(value, label)
	exactKeys(record, ['checkpointSnapshotCount', 'consumptionDispositions', 'cutoff', 'directClaimEvidence', 'directClaimMmr', 'forkSnapshotIds', 'forkSnapshotPools', 'games', 'lastLocalNodeIds', 'pendingSourceSnapshots', 'prefixEventCount', 'prefixEventDigest', 'prefixEventMmr', 'schemaVersion'], label)
	if (record['schemaVersion'] !== 3) throw new Error(`${label}.schemaVersion is unsupported`)
	const cutoffRecord = requiredRecord(record['cutoff'], `${label}.cutoff`)
	exactKeys(cutoffRecord, ['blockHash', 'blockNumber'], `${label}.cutoff`)
	const cutoff: CarryJournalCursor = {
		blockHash: hash(stringField(cutoffRecord, 'blockHash', `${label}.cutoff`), `${label}.cutoff.blockHash`),
		blockNumber: stringField(cutoffRecord, 'blockNumber', `${label}.cutoff`),
	}
	uintString(cutoff.blockNumber, `${label}.cutoff.blockNumber`)
	const prefixEventCount = stringField(record, 'prefixEventCount', label)
	positiveUint(prefixEventCount, `${label}.prefixEventCount`)
	const prefixEventDigest = hash(stringField(record, 'prefixEventDigest', label), `${label}.prefixEventDigest`)
	const prefixEventMmr = parseEventMmrAccumulator(record['prefixEventMmr'], `${label}.prefixEventMmr`, identity)
	const directClaimMmr = parseDirectClaimMmrAccumulator(record['directClaimMmr'], `${label}.directClaimMmr`, identity)
	if (prefixEventMmr.leafCount !== prefixEventCount) throw new Error(`${label}.prefixEventCount does not match its event MMR leaf count`)
	if (prefixEventCommitment(identity, prefixEventMmr, directClaimMmr).toLowerCase() !== prefixEventDigest.toLowerCase()) {
		throw new Error(`${label}.prefixEventDigest does not match its event and direct-claim MMR prefix commitment`)
	}
	const checkpointSnapshotCount = stringField(record, 'checkpointSnapshotCount', label)
	uintString(checkpointSnapshotCount, `${label}.checkpointSnapshotCount`)
	const gamesValue = record['games']
	const snapshotsValue = record['pendingSourceSnapshots']
	const dispositionsValue = record['consumptionDispositions']
	const directClaimEvidenceValue = record['directClaimEvidence']
	const forkSnapshotIdsValue = record['forkSnapshotIds']
	const forkSnapshotPoolsValue = record['forkSnapshotPools']
	const lastLocalNodeIdsValue = record['lastLocalNodeIds']
	if (!Array.isArray(gamesValue)) throw new Error(`${label}.games must be an array`)
	if (!Array.isArray(snapshotsValue)) throw new Error(`${label}.pendingSourceSnapshots must be an array`)
	if (!Array.isArray(dispositionsValue)) throw new Error(`${label}.consumptionDispositions must be an array`)
	if (!Array.isArray(directClaimEvidenceValue)) throw new Error(`${label}.directClaimEvidence must be an array`)
	if (!Array.isArray(forkSnapshotIdsValue)) throw new Error(`${label}.forkSnapshotIds must be an array`)
	if (!Array.isArray(forkSnapshotPoolsValue)) throw new Error(`${label}.forkSnapshotPools must be an array`)
	if (!Array.isArray(lastLocalNodeIdsValue)) throw new Error(`${label}.lastLocalNodeIds must be an array`)
	const games = gamesValue.map(parseCheckpointGame)
	const pendingSourceSnapshots = snapshotsValue.map(parseCheckpointSourceSnapshot)
	const directClaimEvidence = directClaimEvidenceValue.map(parseDirectClaimEvidence)
	const consumptionDispositions = dispositionsValue.map((entry, index): CarryJournalCheckpointConsumptionDisposition => {
		const entryLabel = `${label}.consumptionDispositions[${index.toString()}]`
		const entryRecord = requiredRecord(entry, entryLabel)
		exactKeys(entryRecord, ['game', 'kind', 'outcome', 'parentDepositIndex', 'reason', 'storageBasisAttoRep'], entryLabel)
		const kind = entryRecord['kind']
		if (kind !== 'inherited' && kind !== 'local') throw new Error(`${entryLabel}.kind must be inherited or local`)
		const parentDepositIndex = stringField(entryRecord, 'parentDepositIndex', entryLabel)
		uintString(parentDepositIndex, `${entryLabel}.parentDepositIndex`)
		const reason = parseReason(entryRecord['reason'], `${entryLabel}.reason`)
		if (reason === 4) throw new Error(`${entryLabel}.reason 4 has no canonical producer`)
		const storageBasisAttoRep = stringField(entryRecord, 'storageBasisAttoRep', entryLabel)
		uintString(storageBasisAttoRep, `${entryLabel}.storageBasisAttoRep`)
		return {
			game: address(stringField(entryRecord, 'game', entryLabel), `${entryLabel}.game`),
			kind,
			outcome: parseOutcome(entryRecord['outcome'], `${entryLabel}.outcome`),
			parentDepositIndex,
			reason,
			storageBasisAttoRep,
		}
	})
	const forkSnapshotIds = forkSnapshotIdsValue.map((value, index) => {
		if (typeof value !== 'string') throw new Error(`${label}.forkSnapshotIds[${index.toString()}] must be a string`)
		return hash(value, `${label}.forkSnapshotIds[${index.toString()}]`)
	})
	const forkSnapshotPools = forkSnapshotPoolsValue.map((value, index) => {
		if (typeof value !== 'string') throw new Error(`${label}.forkSnapshotPools[${index.toString()}] must be a string`)
		return address(value, `${label}.forkSnapshotPools[${index.toString()}]`)
	})
	const lastLocalNodeIds = lastLocalNodeIdsValue.map((entry, index) => {
		const entryLabel = `${label}.lastLocalNodeIds[${index.toString()}]`
		const entryRecord = requiredRecord(entry, entryLabel)
		exactKeys(entryRecord, ['game', 'nodeId'], entryLabel)
		const nodeId = stringField(entryRecord, 'nodeId', entryLabel)
		positiveUint(nodeId, `${entryLabel}.nodeId`)
		return { game: address(stringField(entryRecord, 'game', entryLabel), `${entryLabel}.game`), nodeId }
	})
	const unique = (values: readonly string[], subject: string) => {
		const identities = new Set(values)
		if (identities.size !== values.length) throw new Error(`${label} contains duplicate ${subject}`)
	}
	const canonical = (values: readonly string[], subject: string) => {
		for (let index = 1; index < values.length; index += 1) {
			const previous = values[index - 1]
			const current = values[index]
			if (previous === undefined || current === undefined || previous.localeCompare(current) >= 0) throw new Error(`${label} ${subject} are not in strict canonical order`)
		}
	}
	const gameIdentities = games.map(game => game.game.toLowerCase())
	const snapshotIdentities = pendingSourceSnapshots.map(snapshot => snapshot.snapshotId.toLowerCase())
	const dispositionIdentities = consumptionDispositions.map(disposition => consumptionDispositionIdentity(disposition.game, disposition.outcome, disposition.parentDepositIndex))
	const directClaimEvidenceIdentities = directClaimEvidence.map(evidence => directClaimIdentity(evidence.claim.emitter, evidence.claim.outcome, evidence.claim.parentDepositIndex))
	const forkIdentities = forkSnapshotIds.map(snapshotId => snapshotId.toLowerCase())
	const forkPoolIdentities = forkSnapshotPools.map(pool => pool.toLowerCase())
	const lastNodeIdentities = lastLocalNodeIds.map(entry => entry.game.toLowerCase())
	unique(gameIdentities, 'games')
	unique(snapshotIdentities, 'pending source snapshots')
	unique(dispositionIdentities, 'consumption dispositions')
	unique(directClaimEvidenceIdentities, 'direct-claim evidence')
	unique(forkIdentities, 'fork snapshot ids')
	unique(forkPoolIdentities, 'fork snapshot pools')
	unique(lastNodeIdentities, 'last-local-node games')
	canonical(gameIdentities, 'games')
	canonical(snapshotIdentities, 'pending source snapshots')
	canonical(dispositionIdentities, 'consumption dispositions')
	canonical(directClaimEvidenceIdentities, 'direct-claim evidence')
	canonical(forkIdentities, 'fork snapshot ids')
	canonical(forkPoolIdentities, 'fork snapshot pools')
	canonical(lastNodeIdentities, 'last-local-node games')
	const directClaimEventLogs = new Set<string>()
	const directClaimEventLeaves = new Set<string>()
	for (const evidence of directClaimEvidence) {
		verifyEventMmrWitness(identity, evidence.consumption, evidence.consumptionWitness, prefixEventMmr, `${label} direct-claim consumption witness`)
		verifyEventMmrWitness(identity, evidence.claim, evidence.claimWitness, prefixEventMmr, `${label} direct-claim ClaimDeposit witness`)
		if (BigInt(evidence.consumptionWitness.leafIndex) >= BigInt(evidence.claimWitness.leafIndex)) throw new Error(`${label} direct-claim evidence leaf order is invalid`)
		for (const leafIndex of [evidence.consumptionWitness.leafIndex, evidence.claimWitness.leafIndex]) {
			if (directClaimEventLeaves.has(leafIndex)) throw new Error(`${label} contains duplicate direct-claim evidence leaf ${leafIndex}`)
			directClaimEventLeaves.add(leafIndex)
		}
		for (const event of [evidence.consumption, evidence.claim]) {
			if (BigInt(event.position.blockNumber) > BigInt(cutoff.blockNumber)) throw new Error(`${label} direct-claim evidence follows its compacted cutoff`)
			if (event.position.blockNumber === cutoff.blockNumber && event.position.blockHash.toLowerCase() !== cutoff.blockHash.toLowerCase()) {
				throw new Error(`${label} direct-claim evidence disagrees with its compacted cutoff hash`)
			}
			const logIdentity = `${event.position.transactionHash.toLowerCase()}:${event.position.logIndex}`
			if (directClaimEventLogs.has(logIdentity)) throw new Error(`${label} contains duplicate direct-claim evidence log ${logIdentity}`)
			directClaimEventLogs.add(logIdentity)
		}
	}
	const evidenceDerivedDirectClaimMmr = buildDirectClaimMmr(identity, directClaimEvidence)
	if (stableJson(directClaimMmr, `${label} direct-claim MMR`) !== stableJson(evidenceDerivedDirectClaimMmr, `${label} evidence-derived direct-claim MMR`)) {
		throw new Error(`${label} direct-claim MMR does not exactly match its complete canonical direct-claim evidence`)
	}
	const evidenceDerivedDirectClaims = directClaimEvidence.map(directClaimFromEvidence)
	if (BigInt(checkpointSnapshotCount) !== BigInt(forkSnapshotIds.length)) throw new Error(`${label}.checkpointSnapshotCount does not match its fork snapshot identities`)
	const forkIds = new Set(forkSnapshotIds.map(value => value.toLowerCase()))
	const forkPools = new Set(forkSnapshotPools.map(value => value.toLowerCase()))
	if (pendingSourceSnapshots.some(snapshot => !forkIds.has(snapshot.snapshotId.toLowerCase()))) throw new Error(`${label} pending source snapshot lacks its fork uniqueness fact`)
	if (pendingSourceSnapshots.some(snapshot => !forkPools.has(snapshot.sourcePool.toLowerCase()))) throw new Error(`${label} pending source snapshot lacks its fork-pool uniqueness fact`)
	if (forkIds.size !== pendingSourceSnapshots.length) throw new Error(`${label} fork uniqueness facts do not exactly match pending source snapshots`)
	const sourceSnapshotById = new Map(pendingSourceSnapshots.map(snapshot => [snapshot.snapshotId.toLowerCase(), snapshot]))
	for (const game of games) {
		if (game.source === null) continue
		const snapshot = sourceSnapshotById.get(game.source.snapshotId.toLowerCase())
		if (snapshot === undefined || snapshot.sourceGame.toLowerCase() !== game.source.game.toLowerCase() || snapshot.sourcePool.toLowerCase() !== game.source.pool.toLowerCase()) {
			throw new Error(`${label} inherited game ${game.game} lacks its exact source snapshot`)
		}
		if (stableJson(game.directClaimBaselineAttoRep, `${label} game direct-claim baseline`) !== stableJson(snapshot.directClaimBaselineAttoRep, `${label} source direct-claim baseline`)) {
			throw new Error(`${label} inherited game ${game.game} has a conflicting direct-claim baseline`)
		}
		for (const outcome of [0, 1, 2] as const) {
			if (stableJson(game.state.outcomes[outcome].snapshotSlots, `${label} game snapshot slots`) !== stableJson(snapshot.state.outcomes[outcome].currentSlots, `${label} source current slots`)) {
				throw new Error(`${label} inherited game ${game.game} snapshot slots differ from their fork-time source state`)
			}
		}
	}
	const knownGames = new Map(games.map(game => [game.game.toLowerCase(), game]))
	if (pendingSourceSnapshots.some(snapshot => knownGames.get(snapshot.sourceGame.toLowerCase())?.pool.toLowerCase() !== snapshot.sourcePool.toLowerCase())) {
		throw new Error(`${label} has a pending source snapshot with an unknown game/pool route`)
	}
	if (evidenceDerivedDirectClaims.some(claim => !knownGames.has(claim.sourceGame.toLowerCase()))) throw new Error(`${label} has a direct claim for an unknown source game`)
	for (const claim of evidenceDerivedDirectClaims) {
		const source = knownGames.get(claim.sourceGame.toLowerCase())
		if (source === undefined) throw new Error(`${label} has a direct claim for an unknown source game`)
		const slot = source.state.outcomes[claim.outcome].currentSlots.find(candidate => candidate.leaf.parentDepositIndex === claim.parentDepositIndex)
		if (slot === undefined || slot.originGame.toLowerCase() !== claim.sourceGame.toLowerCase() || slot.leaf.amountAttoRep !== claim.amountAttoRep || !slot.consumedLocally || slot.hash !== zeroHash) {
			throw new Error(`${label} direct claim ${directClaimIdentity(claim.sourceGame, claim.outcome, claim.parentDepositIndex)} does not match its source deposit`)
		}
	}
	const directClaimTotals = new Map<string, bigint>()
	for (const claim of evidenceDerivedDirectClaims) {
		const identity = directClaimTotalIdentity(claim.sourceGame, claim.outcome)
		directClaimTotals.set(identity, (directClaimTotals.get(identity) ?? 0n) + BigInt(claim.amountAttoRep))
	}
	for (const snapshot of pendingSourceSnapshots) {
		for (const outcome of [0, 1, 2] as const) {
			if (snapshot.directClaimBaselineAttoRep[outcome] !== '0') throw new Error(`${label} source snapshot has a nonzero direct-claim baseline`)
			if (BigInt(snapshot.directClaimBaselineAttoRep[outcome]) > (directClaimTotals.get(directClaimTotalIdentity(snapshot.sourceGame, outcome)) ?? 0n)) {
				throw new Error(`${label} source snapshot direct-claim baseline exceeds canonical claims`)
			}
		}
	}
	const retentionValidated = new Set<string>()
	const retentionActive = new Set<string>()
	const validateCheckpointRetention = (game: CarryJournalCheckpointGame): void => {
		const gameKey = game.game.toLowerCase()
		if (retentionValidated.has(gameKey)) return
		if (retentionActive.has(gameKey)) throw new Error(`${label} claim-retention ancestry contains a cycle at ${game.game}`)
		retentionActive.add(gameKey)
		let expectedRetention: CarryJournalClaimRetention
		if (game.source === null) {
			if (game.haircut !== null) throw new Error(`${label} root game ${game.game} has a truth-auction haircut`)
			expectedRetention = initialClaimRetention()
		} else {
			const sourceGame = knownGames.get(game.source.game.toLowerCase())
			if (sourceGame === undefined) throw new Error(`${label} inherited game ${game.game} has an unknown claim-retention source`)
			validateCheckpointRetention(sourceGame)
			const inheritedRetention: CarryJournalClaimRetention = {
				exponent: sourceGame.claimRetention.exponent,
				mantissa: sourceGame.claimRetention.mantissa,
				rootSourceGame: sourceGame.claimRetention.rootSourceGame ?? sourceGame.game,
			}
			expectedRetention = game.haircut === null ? inheritedRetention : retentionAfterHaircut(inheritedRetention, BigInt(game.haircut.repBeforeAttoRep), BigInt(game.haircut.repRemainingAttoRep))
		}
		if (stableJson(game.claimRetention, `${label} game claim retention`) !== stableJson(expectedRetention, `${label} expected claim retention`)) {
			throw new Error(`${label} game ${game.game} claim retention is not exactly derivable from its ancestry and haircut`)
		}
		retentionActive.delete(gameKey)
		retentionValidated.add(gameKey)
	}
	for (const game of games) validateCheckpointRetention(game)
	const dispositionByIdentity = new Map(consumptionDispositions.map(disposition => [consumptionDispositionIdentity(disposition.game, disposition.outcome, disposition.parentDepositIndex), disposition]))
	const expectedDispositionIdentities = new Set<string>()
	for (const game of games) {
		for (const outcome of [0, 1, 2] as const) {
			const outcomeState = game.state.outcomes[outcome]
			for (let slotIndex = outcomeState.snapshotSlots.length; slotIndex < outcomeState.currentSlots.length; slotIndex += 1) {
				const slot = outcomeState.currentSlots[slotIndex]
				if (slot?.consumedLocally === true) expectedDispositionIdentities.add(consumptionDispositionIdentity(game.game, outcome, slot.leaf.parentDepositIndex))
			}
			const sourceSnapshot = game.source === null ? undefined : sourceSnapshotById.get(game.source.snapshotId.toLowerCase())
			const inheritedNullifierBaseline = new Map(sourceSnapshot?.state.outcomes[outcome].nullifier.consumed.map(entry => [entry.parentDepositIndex, entry.path]) ?? [])
			const currentNullifiers = new Map(outcomeState.nullifier.consumed.map(entry => [entry.parentDepositIndex, entry.path]))
			if ([...inheritedNullifierBaseline].some(([parentDepositIndex, path]) => currentNullifiers.get(parentDepositIndex) !== path)) {
				throw new Error(`${label} inherited game ${game.game} nullifiers do not retain their source baseline`)
			}
			for (const consumed of outcomeState.nullifier.consumed) {
				if (!inheritedNullifierBaseline.has(consumed.parentDepositIndex)) expectedDispositionIdentities.add(consumptionDispositionIdentity(game.game, outcome, consumed.parentDepositIndex))
			}
		}
	}
	if (expectedDispositionIdentities.size !== dispositionByIdentity.size || [...expectedDispositionIdentities].some(identity => !dispositionByIdentity.has(identity))) {
		throw new Error(`${label} consumption dispositions do not exactly match consumed local slots and inherited nullifiers`)
	}
	const retainedAtCheckpoint = (game: CarryJournalCheckpointGame, amountAttoRep: bigint, parentDepositIndex: string) => {
		const sourceAddress = encodedClaimSource(parentDepositIndex) ?? game.claimRetention.rootSourceGame ?? undefined
		if (sourceAddress === undefined || sourceAddress.toLowerCase() === game.game.toLowerCase()) return amountAttoRep
		const source = knownGames.get(sourceAddress.toLowerCase())
		if (source === undefined) throw new Error(`${label} disposition claim-retention source ${sourceAddress} is absent`)
		const gameMantissa = BigInt(game.claimRetention.mantissa)
		const gameExponent = BigInt(game.claimRetention.exponent)
		const sourceMantissa = BigInt(source.claimRetention.mantissa)
		const sourceExponent = BigInt(source.claimRetention.exponent)
		if (gameExponent < sourceExponent || (gameExponent === sourceExponent && gameMantissa > sourceMantissa)) {
			throw new Error(`${label} disposition claim-retention order for ${game.game} precedes source ${source.game}`)
		}
		const retained = (amountAttoRep * gameMantissa) / sourceMantissa
		const exponentDifference = gameExponent - sourceExponent
		return exponentDifference >= 256n ? 0n : retained >> exponentDifference
	}
	const inheritedStorageBasisByGameOutcome = new Map<string, bigint>()
	const localConsumedByGameOutcome = new Map<string, bigint>()
	const expectedDirectClaims: CarryProofReplayResult['directlyClaimedDeposits'] = []
	for (const disposition of consumptionDispositions) {
		const game = knownGames.get(disposition.game.toLowerCase())
		if (game === undefined) throw new Error(`${label} has a consumption disposition for an unknown game`)
		const outcomeState = game.state.outcomes[disposition.outcome]
		const slotIndex = outcomeState.currentSlots.findIndex(slot => slot.leaf.parentDepositIndex === disposition.parentDepositIndex)
		const slot = slotIndex < 0 ? undefined : outcomeState.currentSlots[slotIndex]
		if (slot === undefined) throw new Error(`${label} consumption disposition does not match a carry slot`)
		const inherited = slotIndex < outcomeState.snapshotSlots.length
		const nullified = outcomeState.nullifier.consumed.some(entry => entry.parentDepositIndex === disposition.parentDepositIndex)
		const sourceSnapshot = game.source === null ? undefined : sourceSnapshotById.get(game.source.snapshotId.toLowerCase())
		const nullifiedAtFork = sourceSnapshot?.state.outcomes[disposition.outcome].nullifier.consumed.some(entry => entry.parentDepositIndex === disposition.parentDepositIndex) === true
		const expectedKind = inherited ? 'inherited' : 'local'
		if (disposition.kind !== expectedKind) throw new Error(`${label} consumption disposition has the wrong local/inherited kind`)
		const accountingIdentity = `${game.game.toLowerCase()}:${disposition.outcome.toString()}`
		if (inherited) {
			if (!nullified || nullifiedAtFork || slot.originGame.toLowerCase() === game.game.toLowerCase() || slot.consumedLocally || slot.hash === zeroHash) {
				throw new Error(`${label} inherited consumption disposition does not match an unconsumed source slot and its nullifier`)
			}
			if (disposition.reason !== 0) throw new Error(`${label} inherited consumption disposition must use reason 0 with a transferred ClaimDeposit`)
			const amountAttoRep = BigInt(slot.leaf.amountAttoRep)
			const cumulativeAmountAttoRep = BigInt(slot.leaf.cumulativeAmountAttoRep)
			if (cumulativeAmountAttoRep < amountAttoRep) throw new Error(`${label} inherited disposition cumulative amount is below its deposit amount`)
			const source = game.source === null ? undefined : knownGames.get(game.source.game.toLowerCase())
			if (source === undefined) throw new Error(`${label} inherited disposition is missing its checkpoint source game`)
			const expectedStorageBasis = retainedAtCheckpoint(source, cumulativeAmountAttoRep, disposition.parentDepositIndex) - retainedAtCheckpoint(source, cumulativeAmountAttoRep - amountAttoRep, disposition.parentDepositIndex)
			if (expectedStorageBasis < 0n || BigInt(disposition.storageBasisAttoRep) !== expectedStorageBasis) {
				throw new Error(`${label} inherited consumption disposition storage basis is not derivable from its source snapshot and claim retention`)
			}
			inheritedStorageBasisByGameOutcome.set(accountingIdentity, (inheritedStorageBasisByGameOutcome.get(accountingIdentity) ?? 0n) + expectedStorageBasis)
		} else {
			if (!slot.consumedLocally || slot.hash !== zeroHash || slot.originGame.toLowerCase() !== game.game.toLowerCase() || nullified) {
				throw new Error(`${label} local consumption disposition does not match its consumed and zeroed local slot`)
			}
			if (disposition.storageBasisAttoRep !== slot.leaf.amountAttoRep) throw new Error(`${label} local consumption disposition storage basis does not match its deposit amount`)
			localConsumedByGameOutcome.set(accountingIdentity, (localConsumedByGameOutcome.get(accountingIdentity) ?? 0n) + BigInt(slot.leaf.amountAttoRep))
			if (disposition.reason === 3) {
				expectedDirectClaims.push({ amountAttoRep: slot.leaf.amountAttoRep, outcome: disposition.outcome, parentDepositIndex: disposition.parentDepositIndex, sourceGame: game.game })
			}
		}
	}
	expectedDirectClaims.sort((left, right) => directClaimIdentity(left.sourceGame, left.outcome, left.parentDepositIndex).localeCompare(directClaimIdentity(right.sourceGame, right.outcome, right.parentDepositIndex)))
	if (stableJson(evidenceDerivedDirectClaims, `${label} canonical ClaimDeposit evidence`) !== stableJson(expectedDirectClaims, `${label} reason-3 consumption claims`)) {
		throw new Error(`${label} canonical ClaimDeposit evidence does not exactly match reason-3 consumption dispositions`)
	}
	for (const game of games) {
		if (game.source === null) continue
		const snapshot = sourceSnapshotById.get(game.source.snapshotId.toLowerCase())
		if (snapshot === undefined || game.rawAccounting === null) throw new Error(`${label} inherited game ${game.game} is missing raw-accounting source evidence`)
		const initialInherited = carryGameAccounting(snapshot.state).unresolvedTotalsAttoRep
		const expectedInherited: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = ['0', '0', '0']
		const expectedLocal: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = ['0', '0', '0']
		for (const outcome of [0, 1, 2] as const) {
			const accountingIdentity = `${game.game.toLowerCase()}:${outcome.toString()}`
			const inheritedBasis = inheritedStorageBasisByGameOutcome.get(accountingIdentity) ?? 0n
			const inheritedBefore = BigInt(initialInherited[outcome])
			const inheritedConsumed = inheritedBasis < inheritedBefore ? inheritedBasis : inheritedBefore
			const overflowConsumed = inheritedBasis - inheritedConsumed
			let localDeposited = 0n
			const outcomeState = game.state.outcomes[outcome]
			for (let slotIndex = outcomeState.snapshotSlots.length; slotIndex < outcomeState.currentSlots.length; slotIndex += 1) {
				const slot = outcomeState.currentSlots[slotIndex]
				if (slot === undefined || slot.originGame.toLowerCase() !== game.game.toLowerCase()) throw new Error(`${label} inherited game ${game.game} has a nonlocal appended slot`)
				localDeposited += BigInt(slot.leaf.amountAttoRep)
			}
			const localConsumed = (localConsumedByGameOutcome.get(accountingIdentity) ?? 0n) + overflowConsumed
			if (localConsumed > localDeposited) throw new Error(`${label} consumption dispositions exceed replay-derived local REP for game ${game.game}`)
			expectedInherited[outcome] = (inheritedBefore - inheritedConsumed).toString()
			expectedLocal[outcome] = (localDeposited - localConsumed).toString()
		}
		const expectedRawAccounting: CarryJournalRawAccounting = { inheritedTotalsAttoRep: expectedInherited, localTotalsAttoRep: expectedLocal }
		if (stableJson(game.rawAccounting, `${label} raw accounting`) !== stableJson(expectedRawAccounting, `${label} disposition-derived raw accounting`)) {
			throw new Error(`${label} game ${game.game} raw accounting is not derivable from its source snapshot and consumption dispositions`)
		}
		if (stableJson(game.localUnresolvedTotalsAttoRep, `${label} local unresolved accounting`) !== stableJson(expectedLocal, `${label} disposition-derived local unresolved accounting`)) {
			throw new Error(`${label} game ${game.game} local unresolved accounting is not derivable from its source snapshot and consumption dispositions`)
		}
	}
	const lastNodeByGame = new Map(lastLocalNodeIds.map(entry => [entry.game.toLowerCase(), BigInt(entry.nodeId)]))
	for (const game of games) {
		let maximum = 0n
		for (const outcomeState of game.state.outcomes) {
			for (const slot of outcomeState.currentSlots) {
				if (slot.originGame.toLowerCase() === game.game.toLowerCase() && BigInt(slot.leaf.sourceNodeId) > maximum) maximum = BigInt(slot.leaf.sourceNodeId)
			}
		}
		if ((lastNodeByGame.get(game.game.toLowerCase()) ?? 0n) !== maximum) throw new Error(`${label} last local node does not match game ${game.game}`)
	}
	if ([...lastNodeByGame.keys()].some(game => !knownGames.has(game))) throw new Error(`${label} has a last local node for an unknown game`)
	return {
		checkpointSnapshotCount,
		consumptionDispositions,
		cutoff,
		directClaimEvidence,
		directClaimMmr,
		forkSnapshotIds,
		forkSnapshotPools,
		games,
		lastLocalNodeIds,
		pendingSourceSnapshots,
		prefixEventCount,
		prefixEventDigest,
		prefixEventMmr,
		schemaVersion: 3,
	}
}

function normalizeJournal(journal: CarryProofJournal, maximumResidentRecords = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS, fieldsAlreadyParsed = false): CarryProofJournal {
	carryProofJournalResidentRecords(journal, maximumResidentRecords)
	if (journal.schemaVersion !== CARRY_PROOF_JOURNAL_SCHEMA_VERSION) throw new Error('Carry proof journal schema version is unsupported')
	if (!Number.isSafeInteger(journal.chainId) || journal.chainId < 1) throw new Error('Carry proof journal chainId must be a positive safe integer')
	if (typeof journal.scanStarted !== 'boolean') throw new Error('Carry proof journal scanStarted must be a boolean')
	const normalizedProfileId = profileId(journal.profileId, 'carry proof journal.profileId')
	const normalizedForker = address(journal.securityPoolForker, 'carry proof journal.securityPoolForker')
	const startBlock = journal.startBlock
	uintString(startBlock, 'carry proof journal.startBlock')
	const cursor: CarryJournalCursor = {
		blockHash: hash(journal.cursor.blockHash, 'carry proof journal.cursor.blockHash'),
		blockNumber: journal.cursor.blockNumber,
	}
	uintString(cursor.blockNumber, 'carry proof journal.cursor.blockNumber')
	if (BigInt(cursor.blockNumber) < BigInt(startBlock)) throw new Error('Carry proof journal cursor precedes startBlock')
	if (!Array.isArray(journal.events)) throw new Error('Carry proof journal events must be an array')
	const journalIdentity: CarryProofJournalExpectedIdentity = { chainId: journal.chainId, profileId: normalizedProfileId, securityPoolForker: normalizedForker, startBlock }
	let checkpoint: CarryProofJournalCheckpoint | undefined
	if (journal.checkpoint !== undefined) checkpoint = fieldsAlreadyParsed ? journal.checkpoint : parseCheckpoint(journal.checkpoint, journalIdentity)
	if (checkpoint !== undefined) {
		if (BigInt(checkpoint.cutoff.blockNumber) < BigInt(startBlock)) throw new Error('Carry proof journal checkpoint cutoff precedes startBlock')
		if (BigInt(checkpoint.cutoff.blockNumber) > BigInt(cursor.blockNumber)) throw new Error('Carry proof journal checkpoint cutoff follows the canonical cursor')
		if (checkpoint.cutoff.blockNumber === cursor.blockNumber && checkpoint.cutoff.blockHash.toLowerCase() !== cursor.blockHash.toLowerCase()) {
			throw new Error('Carry proof journal checkpoint cutoff disagrees with the canonical cursor hash')
		}
	}
	const events = fieldsAlreadyParsed ? journal.events : journal.events.map((event, index) => parseCarryProofJournalEvent(event, index))
	if (!journal.scanStarted && (checkpoint !== undefined || events.length !== 0 || cursor.blockNumber !== startBlock)) {
		throw new Error('Carry proof journal scanStarted=false is valid only for a pristine initial cursor')
	}
	const identities = new Set<string>()
	const logIdentityByBlock = new Set<string>()
	const blockHashByNumber = new Map<string, string>()
	const transactionPositionByHash = new Map<string, string>()
	const transactionHashByPosition = new Map<string, string>()
	let previous: CarryProofJournalEvent | undefined
	for (const [index, event] of events.entries()) {
		if (BigInt(event.position.blockNumber) < BigInt(startBlock)) throw new Error(`Carry proof journal event ${index.toString()} precedes startBlock`)
		if (checkpoint !== undefined && BigInt(event.position.blockNumber) <= BigInt(checkpoint.cutoff.blockNumber)) {
			throw new Error(`Carry proof journal event ${index.toString()} does not follow the compacted block boundary`)
		}
		if (BigInt(event.position.blockNumber) > BigInt(cursor.blockNumber)) throw new Error(`Carry proof journal event ${index.toString()} follows the canonical cursor`)
		if (event.position.blockNumber === cursor.blockNumber && event.position.blockHash.toLowerCase() !== cursor.blockHash.toLowerCase()) {
			throw new Error(`Carry proof journal event ${index.toString()} disagrees with the canonical cursor hash`)
		}
		const knownBlockHash = blockHashByNumber.get(event.position.blockNumber)
		if (knownBlockHash !== undefined && knownBlockHash !== event.position.blockHash.toLowerCase()) throw new Error(`Carry proof journal block ${event.position.blockNumber} has conflicting hashes`)
		blockHashByNumber.set(event.position.blockNumber, event.position.blockHash.toLowerCase())
		const transactionIdentity = event.position.transactionHash.toLowerCase()
		const transactionPosition = `${event.position.blockNumber}:${event.position.blockHash.toLowerCase()}:${event.position.transactionIndex}`
		const knownTransactionPosition = transactionPositionByHash.get(transactionIdentity)
		if (knownTransactionPosition !== undefined && knownTransactionPosition !== transactionPosition) throw new Error(`Carry proof journal transaction ${event.position.transactionHash} has conflicting canonical positions`)
		const knownTransactionHash = transactionHashByPosition.get(transactionPosition)
		if (knownTransactionHash !== undefined && knownTransactionHash !== transactionIdentity) throw new Error(`Carry proof journal canonical transaction position ${transactionPosition} has conflicting hashes`)
		transactionPositionByHash.set(transactionIdentity, transactionPosition)
		transactionHashByPosition.set(transactionPosition, transactionIdentity)
		const identity = `${transactionIdentity}:${event.position.logIndex}`
		if (identities.has(identity)) throw new Error(`Carry proof journal contains duplicate log ${identity}`)
		identities.add(identity)
		const blockLogIdentity = `${event.position.blockNumber}:${event.position.logIndex}`
		if (logIdentityByBlock.has(blockLogIdentity)) throw new Error(`Carry proof journal contains duplicate block log index ${blockLogIdentity}`)
		logIdentityByBlock.add(blockLogIdentity)
		if (previous !== undefined && comparePositions(previous.position, event.position) >= 0) throw new Error(`Carry proof journal event ${index.toString()} is not in strict canonical order`)
		previous = event
	}
	return {
		chainId: journal.chainId,
		...(checkpoint === undefined ? {} : { checkpoint }),
		cursor,
		events,
		profileId: normalizedProfileId,
		scanStarted: journal.scanStarted,
		schemaVersion: CARRY_PROOF_JOURNAL_SCHEMA_VERSION,
		securityPoolForker: normalizedForker,
		startBlock,
	}
}

export function createCarryProofJournal(identity: CarryProofJournalIdentity): CarryProofJournal {
	return normalizeJournal({
		chainId: identity.chainId,
		cursor: { ...identity.initialCursor },
		events: [],
		profileId: identity.profileId,
		scanStarted: false,
		schemaVersion: CARRY_PROOF_JOURNAL_SCHEMA_VERSION,
		securityPoolForker: identity.securityPoolForker,
		startBlock: identity.startBlock,
	})
}

export function assessCarryJournalReorg(journal: CarryProofJournal, canonicalCursor: CarryJournalCursor): CarryJournalReorgAssessment {
	const normalized = normalizeJournal(journal)
	uintString(canonicalCursor.blockNumber, 'Canonical carry cursor blockNumber')
	hash(canonicalCursor.blockHash, 'Canonical carry cursor blockHash')
	if (BigInt(canonicalCursor.blockNumber) < BigInt(normalized.cursor.blockNumber)) {
		return {
			reason: `Canonical head ${canonicalCursor.blockNumber} is behind persisted cursor ${normalized.cursor.blockNumber}`,
			resetFromBlock: normalized.startBlock,
			resetRequired: true,
		}
	}
	if (canonicalCursor.blockNumber === normalized.cursor.blockNumber && canonicalCursor.blockHash.toLowerCase() !== normalized.cursor.blockHash.toLowerCase()) {
		return {
			reason: `Canonical hash at persisted cursor ${normalized.cursor.blockNumber} changed`,
			resetFromBlock: normalized.startBlock,
			resetRequired: true,
		}
	}
	if (BigInt(canonicalCursor.blockNumber) > BigInt(normalized.cursor.blockNumber)) {
		return {
			reason: `Canonical observation at ${canonicalCursor.blockNumber} does not authenticate persisted cursor ${normalized.cursor.blockNumber}; query the persisted block hash before continuing`,
			resetFromBlock: normalized.startBlock,
			resetRequired: true,
		}
	}
	return { resetRequired: false }
}

function appendedCarryProofJournal(current: CarryProofJournal, additions: readonly CarryProofJournalEvent[], cursor: CarryJournalCursor, maximumResidentRecords = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS) {
	uintString(cursor.blockNumber, 'Next carry cursor blockNumber')
	hash(cursor.blockHash, 'Next carry cursor blockHash')
	if (BigInt(cursor.blockNumber) < BigInt(current.cursor.blockNumber)) throw new Error('Next carry cursor cannot move backwards')
	if (cursor.blockNumber === current.cursor.blockNumber && cursor.blockHash.toLowerCase() !== current.cursor.blockHash.toLowerCase()) {
		throw new Error('Next carry cursor changes the current canonical hash; reset is required')
	}
	for (const [index, addition] of additions.entries()) {
		if (BigInt(addition.position.blockNumber) < BigInt(current.cursor.blockNumber)) throw new Error(`Added carry event ${index.toString()} precedes the persisted cursor`)
	}
	return normalizeJournal(
		{
			...current,
			cursor: { ...cursor },
			events: [...current.events, ...additions],
			scanStarted: true,
		},
		maximumResidentRecords,
	)
}

export function appendCarryProofJournalEvents(journal: CarryProofJournal, additions: readonly CarryProofJournalEvent[], cursor: CarryJournalCursor): CarryProofJournal {
	return appendedCarryProofJournal(normalizeJournal(journal), additions, cursor)
}

function checkpointFromEvent(event: ForkCarryCheckpointJournalEvent): CarryCheckpoint {
	return {
		carryRoots: event.carryRoots,
		leafCounts: event.leafCounts,
		nullifierRoots: event.nullifierRoots,
		resolutionBalancesAttoRep: event.resolutionBalancesAttoRep,
		snapshotId: event.snapshotId,
		sourceGame: event.sourceGame,
		targetGame: event.emitter,
		unresolvedTotalsAttoRep: event.unresolvedTotalsAttoRep,
	}
}

const INITIAL_CLAIM_RETENTION_MANTISSA = 1n << 255n

function initialClaimRetention(): CarryJournalClaimRetention {
	return {
		exponent: '0',
		mantissa: INITIAL_CLAIM_RETENTION_MANTISSA.toString(),
		rootSourceGame: null,
	}
}

function floorLog2(value: bigint, label: string) {
	if (value <= 0n) throw new Error(`${label} must be positive`)
	return BigInt(value.toString(2).length - 1)
}

function retentionAfterHaircut(retention: CarryJournalClaimRetention, before: bigint, remaining: bigint): CarryJournalClaimRetention {
	let ratioShift = floorLog2(before, 'Truth-auction REP before') - floorLog2(remaining, 'Truth-auction REP remaining')
	let scaledRemaining = remaining << ratioShift
	if (scaledRemaining > before) {
		scaledRemaining >>= 1n
		ratioShift -= 1n
	}
	const previousMantissa = BigInt(retention.mantissa)
	const nextRetention = (previousMantissa * scaledRemaining) / before
	const normalizationShift = 255n - floorLog2(nextRetention, 'Truth-auction claim retention')
	const exponent = BigInt(retention.exponent) + ratioShift + normalizationShift
	if (exponent > MAXIMUM_UINT256) throw new Error('Truth-auction claim-retention exponent exceeds uint256')
	return {
		exponent: exponent.toString(),
		mantissa: (nextRetention << normalizationShift).toString(),
		rootSourceGame: retention.rootSourceGame,
	}
}

function encodedClaimSource(parentDepositIndex: string) {
	const encoded = BigInt(parentDepositIndex) >> 96n
	if (encoded === 0n) return undefined
	return getAddress(toHex(encoded, { size: 20 }))
}

function proofClaimSourceGame(game: ReplayGameInternal, parentDepositIndex: string) {
	const source = encodedClaimSource(parentDepositIndex) ?? game.claimRetention.rootSourceGame ?? game.sourceGame
	if (source === undefined) throw new Error(`Carry proof candidate game ${game.game} is missing claim-source metadata`)
	return source
}

function applyClaimRetention(working: ReplayWorkingSet, game: ReplayGameInternal, amountAttoRep: bigint, parentDepositIndex: string) {
	const sourceAddress = encodedClaimSource(parentDepositIndex) ?? game.claimRetention.rootSourceGame ?? undefined
	if (sourceAddress === undefined || sourceAddress.toLowerCase() === game.game.toLowerCase()) return amountAttoRep
	const source = working.games.get(sourceAddress.toLowerCase())
	if (source === undefined) throw new Error(`Carry claim-retention root ${sourceAddress} is absent from canonical replay`)
	const gameMantissa = BigInt(game.claimRetention.mantissa)
	const gameExponent = BigInt(game.claimRetention.exponent)
	const sourceMantissa = BigInt(source.claimRetention.mantissa)
	const sourceExponent = BigInt(source.claimRetention.exponent)
	if (gameExponent < sourceExponent || (gameExponent === sourceExponent && gameMantissa > sourceMantissa)) {
		throw new Error(`Carry claim-retention order for ${game.game} precedes source ${source.game}`)
	}
	const retained = (amountAttoRep * gameMantissa) / sourceMantissa
	const exponentDifference = gameExponent - sourceExponent
	return exponentDifference >= 256n ? 0n : retained >> exponentDifference
}

function inheritedSourceStorageBasis(working: ReplayWorkingSet, game: ReplayGameInternal, amountAttoRep: bigint, cumulativeAmountAttoRep: bigint, parentDepositIndex: string) {
	if (game.sourceGame === undefined) return amountAttoRep
	if (cumulativeAmountAttoRep < amountAttoRep) throw new Error('Carry cumulative amount is below its deposit amount')
	const source = working.games.get(game.sourceGame.toLowerCase())
	if (source === undefined) throw new Error(`Carry storage-basis source ${game.sourceGame} is absent from canonical replay`)
	const retainedCumulative = applyClaimRetention(working, source, cumulativeAmountAttoRep, parentDepositIndex)
	const retainedPrevious = applyClaimRetention(working, source, cumulativeAmountAttoRep - amountAttoRep, parentDepositIndex)
	if (retainedCumulative < retainedPrevious) throw new Error('Carry source-storage retention is not monotonic')
	return retainedCumulative - retainedPrevious
}

function createReplayGame(game: Address, pool: Address): ReplayGameInternal {
	return {
		accumulator: createCarryProofAccumulator(game, pool),
		claimRetention: initialClaimRetention(),
		directClaimBaselineAttoRep: null,
		game,
		haircut: null,
		localUnresolvedTotalsAttoRep: ['0', '0', '0'],
		pool,
		rawAccounting: null,
	}
}

function ensureReplayGame(working: ReplayWorkingSet, game: Address, pool: Address) {
	const key = game.toLowerCase()
	const current = working.games.get(key)
	if (current !== undefined) {
		if (current.pool.toLowerCase() !== pool.toLowerCase()) throw new Error(`Carry game ${game} was associated with conflicting pools`)
		return current
	}
	reserveDerivedReplayCost(working, CARRY_PROOF_REPLAY_GAME_BASE_COST)
	const created = createReplayGame(game, pool)
	working.games.set(key, created)
	return created
}

function claimIdentity(event: Pick<ClaimDepositJournalEvent | CarryDepositConsumedJournalEvent, 'emitter' | 'outcome' | 'parentDepositIndex' | 'position'>) {
	return `${event.position.transactionHash.toLowerCase()}:${event.emitter.toLowerCase()}:${event.outcome.toString()}:${event.parentDepositIndex}`
}

function consumptionDispositionIdentity(game: Address, outcome: CarryOutcome, parentDepositIndex: string) {
	return `${game.toLowerCase()}:${outcome.toString()}:${parentDepositIndex}`
}

function directClaimIdentity(sourceGame: Address, outcome: CarryOutcome, parentDepositIndex: string) {
	return `${sourceGame.toLowerCase()}:${outcome.toString()}:${parentDepositIndex}`
}

function directClaimTotalIdentity(sourceGame: Address, outcome: CarryOutcome) {
	return `${sourceGame.toLowerCase()}:${outcome.toString()}`
}

function addDirectClaim(working: ReplayWorkingSet, claim: { amountAttoRep: CanonicalUintString; sourceGame: Address; outcome: CarryOutcome; parentDepositIndex: string }, synchronizeContinuations = true) {
	const identity = directClaimIdentity(claim.sourceGame, claim.outcome, claim.parentDepositIndex)
	if (working.directClaims.has(identity)) throw new Error(`Direct parent claim ${identity} is duplicated`)
	reserveDerivedReplayCost(working, 2)
	working.directClaims.set(identity, { ...claim })
	const totalIdentity = directClaimTotalIdentity(claim.sourceGame, claim.outcome)
	working.directClaimTotalsBySourceOutcome.set(totalIdentity, (working.directClaimTotalsBySourceOutcome.get(totalIdentity) ?? 0n) + BigInt(claim.amountAttoRep))
	if (synchronizeContinuations) {
		for (const continuation of working.continuationGamesBySourceGame.get(claim.sourceGame.toLowerCase()) ?? []) synchronizeReplayGameAccounting(working, continuation)
	}
}

function addDirectClaimEvidence(working: ReplayWorkingSet, evidence: ReplayDirectClaimEvidence) {
	const claim = directClaimFromEvidence(evidence)
	const identity = directClaimIdentity(claim.sourceGame, claim.outcome, claim.parentDepositIndex)
	if (working.directClaimEvidence.has(identity)) throw new Error(`Direct parent ClaimDeposit evidence ${identity} is duplicated`)
	reserveDerivedReplayCost(working, 2)
	working.directClaimEvidence.set(identity, {
		claim: { ...evidence.claim, position: { ...evidence.claim.position } },
		...(evidence.claimWitness === undefined ? {} : { claimWitness: { leafIndex: evidence.claimWitness.leafIndex, siblings: [...evidence.claimWitness.siblings] } }),
		consumption: { ...evidence.consumption, position: { ...evidence.consumption.position } },
		...(evidence.consumptionWitness === undefined ? {} : { consumptionWitness: { leafIndex: evidence.consumptionWitness.leafIndex, siblings: [...evidence.consumptionWitness.siblings] } }),
	})
}

function directClaimTotal(working: ReplayWorkingSet, sourceGame: Address, outcome: CarryOutcome) {
	return working.directClaimTotalsBySourceOutcome.get(directClaimTotalIdentity(sourceGame, outcome)) ?? 0n
}

function directClaimDelta(working: ReplayWorkingSet, game: ReplayGameInternal, outcome: CarryOutcome) {
	if (game.sourceGame === undefined || game.directClaimBaselineAttoRep === null) return 0n
	const current = directClaimTotal(working, game.sourceGame, outcome)
	const baseline = BigInt(game.directClaimBaselineAttoRep[outcome])
	if (current < baseline) throw new Error(`Carry game ${game.game} direct-claim total precedes its fork snapshot baseline`)
	return current - baseline
}

function effectiveReplayGameAccounting(working: ReplayWorkingSet, game: ReplayGameInternal, finalResolution?: CarryOutcome): CarryAccounting {
	if (game.rawAccounting === null) return carryProofAccumulatorAccounting(game.accumulator)
	const current = carryProofAccumulatorAccounting(game.accumulator)
	const unresolvedTotalsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = ['0', '0', '0']
	for (const outcome of [0, 1, 2] as const) {
		const inherited = BigInt(game.rawAccounting.inheritedTotalsAttoRep[outcome])
		const directlyClaimed = directClaimDelta(working, game, outcome)
		if (directlyClaimed > inherited) throw new Error(`Carry game ${game.game} directly claimed principal exceeds inherited outcome ${outcome.toString()} REP`)
		let effectiveInherited = inherited - directlyClaimed
		if (finalResolution !== undefined && finalResolution !== outcome) effectiveInherited = 0n
		else if (game.haircut !== null) effectiveInherited = (effectiveInherited * BigInt(game.haircut.repRemainingAttoRep)) / BigInt(game.haircut.repBeforeAttoRep)
		unresolvedTotalsAttoRep[outcome] = (effectiveInherited + BigInt(game.rawAccounting.localTotalsAttoRep[outcome])).toString()
	}
	return { resolutionBalancesAttoRep: current.resolutionBalancesAttoRep, unresolvedTotalsAttoRep }
}

function synchronizeReplayGameAccounting(working: ReplayWorkingSet, game: ReplayGameInternal, finalResolution?: CarryOutcome) {
	if (game.rawAccounting === null) return
	setCarryProofAccumulatorAccounting(game.accumulator, effectiveReplayGameAccounting(working, game, finalResolution))
}

function registerContinuationGame(working: ReplayWorkingSet, game: ReplayGameInternal) {
	if (game.sourceGame === undefined) return
	const sourceKey = game.sourceGame.toLowerCase()
	const games = working.continuationGamesBySourceGame.get(sourceKey)
	if (games === undefined) {
		reserveDerivedReplayCost(working, 1)
		working.continuationGamesBySourceGame.set(sourceKey, new Set([game]))
	} else {
		reserveDerivedReplayCost(working, 1)
		games.add(game)
	}
}

function carryOutcome(value: number): CarryOutcome {
	if (value === 0 || value === 1 || value === 2) return value
	throw new Error(`Carry outcome ${value.toString()} is outside the commitment triple`)
}

function carryTriple<T>(first: T, second: T, third: T): CarryTriple<T> {
	return [first, second, third]
}

function carryTripleWith<T>(values: CarryTriple<T>, outcome: CarryOutcome, value: T): CarryTriple<T> {
	if (outcome === 0) return [value, values[1], values[2]]
	if (outcome === 1) return [values[0], value, values[2]]
	return [values[0], values[1], value]
}

/**
 * Derives the only accounting triples accepted for TruthAuctionHaircutApplied.
 * `localUnresolvedTotalsAttoRep` is replay-derived and remains exempt from the
 * inherited haircut, so no same-block RPC read is needed or trusted.
 */
export function deriveTruthAuctionHaircutAccounting(accounting: CarryAccounting, localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>, repBeforeAttoRep: CanonicalUintString, repRemainingAttoRep: CanonicalUintString): CarryAccounting {
	const before = positiveUint(repBeforeAttoRep, 'Truth-auction haircut repBeforeAttoRep')
	const remaining = positiveUint(repRemainingAttoRep, 'Truth-auction haircut repRemainingAttoRep')
	if (remaining > before) throw new Error('Truth-auction haircut remaining REP exceeds REP before the haircut')
	const unresolvedTotalsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = [canonicalUintString(0n), canonicalUintString(0n), canonicalUintString(0n)]
	const resolutionBalancesAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = [canonicalUintString(0n), canonicalUintString(0n), canonicalUintString(0n)]
	for (let outcome = 0; outcome < 3; outcome += 1) {
		const typedOutcome = carryOutcome(outcome)
		const total = uintString(accounting.unresolvedTotalsAttoRep[typedOutcome], `Truth-auction haircut outcome ${outcome.toString()} unresolved total`)
		const balance = uintString(accounting.resolutionBalancesAttoRep[typedOutcome], `Truth-auction haircut outcome ${outcome.toString()} resolution balance`)
		const local = uintString(localUnresolvedTotalsAttoRep[typedOutcome], `Truth-auction haircut outcome ${outcome.toString()} local unresolved total`)
		if (local > total) throw new Error(`Truth-auction haircut outcome ${outcome.toString()} local unresolved accounting exceeds its total`)
		resolutionBalancesAttoRep[typedOutcome] = ((balance * remaining) / before).toString()
		unresolvedTotalsAttoRep[typedOutcome] = (((total - local) * remaining) / before + local).toString()
	}
	return { resolutionBalancesAttoRep, unresolvedTotalsAttoRep }
}

function transactionPoolIdentity(event: CarryProofJournalEvent) {
	return `${event.position.transactionHash.toLowerCase()}:${event.pool.toLowerCase()}`
}

function processLocalDeposit(event: LocalDepositAppendedJournalEvent, working: ReplayWorkingSet) {
	const game = ensureReplayGame(working, event.emitter, event.pool)
	const nodeIdentity = `${event.emitter.toLowerCase()}:${event.nodeId}`
	if (working.localNodeIdentities.has(nodeIdentity)) throw new Error(`LocalDepositAppended node ${nodeIdentity} is duplicated`)
	const previousNodeId = working.lastLocalNodeIdByGame.get(event.emitter.toLowerCase())
	if (previousNodeId !== undefined && BigInt(event.nodeId) <= previousNodeId) throw new Error(`LocalDepositAppended node ${event.nodeId} is not strictly increasing for game ${event.emitter}`)
	working.localNodeIdentities.add(nodeIdentity)
	working.lastLocalNodeIdByGame.set(event.emitter.toLowerCase(), BigInt(event.nodeId))
	const leaf: CarryLeaf = {
		amountAttoRep: event.amountAttoRep,
		cumulativeAmountAttoRep: event.cumulativeAmountAttoRep,
		depositor: event.depositor,
		outcome: event.outcome,
		parentDepositIndex: event.parentDepositIndex,
		sourceNodeId: event.nodeId,
	}
	reserveDerivedReplayCost(working, CARRY_PROOF_REPLAY_SLOT_COST)
	appendCarryLeafToAccumulator(game.accumulator, leaf)
	game.localUnresolvedTotalsAttoRep[event.outcome] = (BigInt(game.localUnresolvedTotalsAttoRep[event.outcome]) + BigInt(event.amountAttoRep)).toString()
	if (game.rawAccounting !== null) {
		game.rawAccounting = {
			...game.rawAccounting,
			localTotalsAttoRep: carryTripleWith(game.rawAccounting.localTotalsAttoRep, event.outcome, (BigInt(game.rawAccounting.localTotalsAttoRep[event.outcome]) + BigInt(event.amountAttoRep)).toString()),
		}
	}
}

function processCarryConsumption(event: CarryDepositConsumedJournalEvent, working: ReplayWorkingSet) {
	if (event.reason === 4) throw new Error('Carry consumption reason 4 has no canonical producer in the deployed contract surface')
	const game = ensureReplayGame(working, event.emitter, event.pool)
	const slot = carryProofAccumulatorConsumptionSlot(game.accumulator, event)
	const inherited = slot.originGame.toLowerCase() !== game.game.toLowerCase()
	if (inherited && event.reason !== 0) throw new Error(`Inherited carry consumption must use WinningClaim reason 0, received ${event.reason.toString()}`)
	if (inherited) reserveDerivedReplayCost(working, CARRY_PROOF_REPLAY_NULLIFIER_COST)
	const kind = applyCarryConsumptionToAccumulator(game.accumulator, {
		amountAttoRep: event.amountAttoRep,
		depositor: event.depositor,
		expectedCarryRoot: event.resultingCarryRoot,
		expectedNullifierRoot: event.resultingNullifierRoot,
		outcome: event.outcome,
		parentDepositIndex: event.parentDepositIndex,
		resultingUnresolvedTotalAttoRep: event.resultingUnresolvedTotalAttoRep,
		sourceNodeId: event.sourceNodeId,
	})
	const previousLocal = BigInt(game.localUnresolvedTotalsAttoRep[event.outcome])
	let storageBasisAttoRep = BigInt(event.amountAttoRep)
	if (kind === 'local') {
		if (BigInt(event.amountAttoRep) > previousLocal) throw new Error('Carry local consumption exceeds replayed local unresolved accounting')
		game.localUnresolvedTotalsAttoRep[event.outcome] = (previousLocal - BigInt(event.amountAttoRep)).toString()
	}
	if (kind === 'inherited' && game.rawAccounting === null) throw new Error('Inherited carry consumption is missing reconstructed raw accounting')
	if (game.rawAccounting !== null) {
		if (kind === 'local') {
			const amountAttoRep = BigInt(event.amountAttoRep)
			const rawLocal = BigInt(game.rawAccounting.localTotalsAttoRep[event.outcome])
			if (amountAttoRep > rawLocal) throw new Error('Carry local consumption exceeds reconstructed raw local REP')
			game.rawAccounting = { ...game.rawAccounting, localTotalsAttoRep: carryTripleWith(game.rawAccounting.localTotalsAttoRep, event.outcome, (rawLocal - amountAttoRep).toString()) }
		} else {
			const sourceBasisAttoRep = inheritedSourceStorageBasis(working, game, BigInt(event.amountAttoRep), BigInt(slot.leaf.cumulativeAmountAttoRep), event.parentDepositIndex)
			storageBasisAttoRep = sourceBasisAttoRep
			const rawInherited = BigInt(game.rawAccounting.inheritedTotalsAttoRep[event.outcome])
			const inheritedConsumed = sourceBasisAttoRep < rawInherited ? sourceBasisAttoRep : rawInherited
			const localConsumed = sourceBasisAttoRep - inheritedConsumed
			const rawLocal = BigInt(game.rawAccounting.localTotalsAttoRep[event.outcome])
			if (localConsumed > rawLocal) throw new Error('Carry inherited consumption exceeds reconstructed raw carry REP')
			if (localConsumed > previousLocal) throw new Error('Carry inherited consumption exceeds replayed local unresolved REP')
			game.localUnresolvedTotalsAttoRep[event.outcome] = (previousLocal - localConsumed).toString()
			game.rawAccounting = {
				inheritedTotalsAttoRep: carryTripleWith(game.rawAccounting.inheritedTotalsAttoRep, event.outcome, (rawInherited - inheritedConsumed).toString()),
				localTotalsAttoRep: carryTripleWith(game.rawAccounting.localTotalsAttoRep, event.outcome, (rawLocal - localConsumed).toString()),
			}
		}
	}
	if (kind === 'inherited') {
		if (game.sourceGame === undefined || game.rawAccounting === null) throw new Error('Inherited carry consumption is missing source accounting')
		const rawInherited = BigInt(game.rawAccounting.inheritedTotalsAttoRep[event.outcome])
		const directlyClaimed = directClaimDelta(working, game, event.outcome)
		if (directlyClaimed > rawInherited) throw new Error('Carry directly claimed principal exceeds reconstructed inherited REP')
		const effectiveInherited = game.haircut === null ? rawInherited - directlyClaimed : ((rawInherited - directlyClaimed) * BigInt(game.haircut.repRemainingAttoRep)) / BigInt(game.haircut.repBeforeAttoRep)
		const expectedUnresolved = effectiveInherited + BigInt(game.rawAccounting.localTotalsAttoRep[event.outcome])
		if (BigInt(event.resultingUnresolvedTotalAttoRep) !== expectedUnresolved) {
			throw new Error(`Inherited carry consumption resulting unresolved total ${event.resultingUnresolvedTotalAttoRep} does not match replay-derived ${expectedUnresolved.toString()}`)
		}
	}
	if (BigInt(event.resultingUnresolvedTotalAttoRep) < BigInt(game.localUnresolvedTotalsAttoRep[event.outcome])) {
		throw new Error('Carry consumption reduced unresolved accounting below replayed local REP')
	}
	const dispositionIdentity = consumptionDispositionIdentity(event.emitter, event.outcome, event.parentDepositIndex)
	if (working.consumptionDispositions.has(dispositionIdentity)) throw new Error(`Carry consumption disposition ${dispositionIdentity} is duplicated`)
	reserveDerivedReplayCost(working, 1)
	working.consumptionDispositions.set(dispositionIdentity, {
		game: event.emitter,
		kind,
		outcome: event.outcome,
		parentDepositIndex: event.parentDepositIndex,
		reason: event.reason,
		storageBasisAttoRep: storageBasisAttoRep.toString(),
	})
	const identity = claimIdentity(event)
	if (working.consumptionByClaimIdentity.has(identity)) throw new Error(`Carry consumption identity ${identity} is duplicated`)
	working.consumptionByClaimIdentity.set(identity, event)
}

function processClaim(event: ClaimDepositJournalEvent, working: ReplayWorkingSet) {
	ensureReplayGame(working, event.emitter, event.pool)
	const identity = claimIdentity(event)
	if (working.claimIdentities.has(identity)) throw new Error(`ClaimDeposit ${identity} is duplicated`)
	const consumption = working.consumptionByClaimIdentity.get(identity)
	if (consumption === undefined) throw new Error(`ClaimDeposit ${identity} is not preceded by its CarryDepositConsumed event in the same transaction`)
	if (consumption.depositor.toLowerCase() !== event.depositor.toLowerCase() || consumption.amountAttoRep !== event.originalDepositAmountAttoRep) {
		throw new Error(`ClaimDeposit ${identity} does not match its carry consumption identity and amount`)
	}
	const expectedReason = event.transferredRep ? 0 : 3
	if (consumption.reason !== expectedReason) throw new Error(`ClaimDeposit ${identity} has carry reason ${consumption.reason.toString()} instead of ${expectedReason.toString()}`)
	working.claimIdentities.add(identity)
	if (!event.transferredRep) {
		addDirectClaim(working, {
			amountAttoRep: event.originalDepositAmountAttoRep,
			outcome: event.outcome,
			parentDepositIndex: event.parentDepositIndex,
			sourceGame: event.emitter,
		})
		addDirectClaimEvidence(working, { claim: event, consumption })
	}
}

function processHaircut(event: TruthAuctionHaircutJournalEvent, working: ReplayWorkingSet) {
	const game = ensureReplayGame(working, event.emitter, event.pool)
	if (game.sourceGame === undefined || game.snapshotId === undefined) throw new Error(`Truth-auction haircut game ${game.game} is not a fork continuation`)
	if (game.haircut !== null) throw new Error(`Carry game ${game.game} contains more than one truth-auction haircut`)
	const expected = truthAuctionHaircutAccountingForReplayGame(working, game, event.repBeforeAttoRep, event.repRemainingAttoRep)
	for (let outcome = 0; outcome < 3; outcome += 1) {
		const typedOutcome = carryOutcome(outcome)
		if (event.resultingResolutionBalancesAttoRep[typedOutcome] !== expected.resolutionBalancesAttoRep[typedOutcome]) {
			throw new Error(`Truth-auction haircut outcome ${outcome.toString()} resolution balance is not derivable from the decoded event`)
		}
		if (event.resultingUnresolvedTotalsAttoRep[typedOutcome] !== expected.unresolvedTotalsAttoRep[typedOutcome]) {
			throw new Error(`Truth-auction haircut outcome ${outcome.toString()} unresolved total is not derivable from the decoded event`)
		}
	}
	setCarryProofAccumulatorAccounting(game.accumulator, expected)
	game.claimRetention = retentionAfterHaircut(game.claimRetention, BigInt(event.repBeforeAttoRep), BigInt(event.repRemainingAttoRep))
	game.haircut = {
		rebasedElapsed: event.rebasedElapsed,
		repBeforeAttoRep: event.repBeforeAttoRep,
		repRemainingAttoRep: event.repRemainingAttoRep,
		repRemovedAttoRep: event.repRemovedAttoRep,
	}
}

function processForkDrain(event: DisputeStakedRepDrainedJournalEvent, securityPoolForker: Address, working: ReplayWorkingSet) {
	if (event.emitter.toLowerCase() !== securityPoolForker.toLowerCase()) throw new Error('DisputeStakedRepDrainedAtFork emitter is not the journal SecurityPoolForker')
	const key = transactionPoolIdentity(event)
	if (working.drainByTransactionAndPool.has(key)) throw new Error(`Fork drain ${key} is duplicated`)
	working.drainByTransactionAndPool.set(key, event)
}

function replayGameSnapshotId(game: ReplayGameInternal) {
	const accounting = carryProofAccumulatorAccounting(game.accumulator)
	const invalidCommitment = carryProofAccumulatorCommitment(game.accumulator, 0)
	const noCommitment = carryProofAccumulatorCommitment(game.accumulator, 1)
	const yesCommitment = carryProofAccumulatorCommitment(game.accumulator, 2)
	return carryCheckpointSnapshotId({
		carryRoots: [invalidCommitment.root, noCommitment.root, yesCommitment.root],
		leafCounts: [invalidCommitment.leafCount, noCommitment.leafCount, yesCommitment.leafCount],
		nullifierRoots: [carryProofAccumulatorNullifierRoot(game.accumulator, 0), carryProofAccumulatorNullifierRoot(game.accumulator, 1), carryProofAccumulatorNullifierRoot(game.accumulator, 2)],
		resolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
		sourceGame: game.game,
		unresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
	})
}

function authenticateForkSnapshotAccounting(event: SecurityPoolForkSnapshotJournalEvent, source: ReplayGameInternal, working: ReplayWorkingSet) {
	const original = carryProofAccumulatorAccounting(source.accumulator)
	const finalOutcomes: Array<CarryOutcome | undefined> = event.ownFork ? [undefined] : [undefined, 0, 1, 2]
	for (const finalOutcome of finalOutcomes) {
		synchronizeReplayGameAccounting(working, source, finalOutcome)
		if (replayGameSnapshotId(source).toLowerCase() === event.escalationSnapshotId.toLowerCase()) {
			const snapshotState = materializeCarryProofAccumulatorState(source.accumulator)
			setCarryProofAccumulatorAccounting(source.accumulator, original)
			return snapshotState
		}
	}
	setCarryProofAccumulatorAccounting(source.accumulator, original)
	throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} does not match any canonical source carry state`)
}

function processForkSnapshot(event: SecurityPoolForkSnapshotJournalEvent, context: ReplayContext, working: ReplayWorkingSet) {
	if (event.emitter.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('SecurityPoolForkSnapshot emitter is not the journal SecurityPoolForker')
	const poolKey = event.pool.toLowerCase()
	if (working.forkSnapshotPools.has(poolKey)) throw new Error(`SecurityPoolForkSnapshot pool ${event.pool} is duplicated`)
	reserveDerivedReplayCost(working, 1)
	working.forkSnapshotPools.add(poolKey)
	const snapshotKey = event.escalationSnapshotId.toLowerCase()
	if (!event.unresolvedEscalation) {
		if (event.ownFork) throw new Error('Resolved SecurityPoolForkSnapshot cannot be an own fork')
		if (event.escalationSnapshotId !== zeroHash) throw new Error('Resolved SecurityPoolForkSnapshot has a nonzero escalation snapshot id')
		if (event.escalationSourceRepAtForkAttoRep !== '0' || event.escalationChildRepAtForkAttoRep !== '0') {
			throw new Error('Resolved SecurityPoolForkSnapshot has nonzero escalation REP')
		}
		if (event.escalationStartBondAtForkAttoRep !== '0' || event.escalationNonDecisionThresholdAtForkAttoRep !== '0' || event.escalationElapsedAtFork !== '0') {
			throw new Error('Resolved SecurityPoolForkSnapshot has nonzero escalation timing or threshold fields')
		}
		if (working.drainByTransactionAndPool.has(transactionPoolIdentity(event))) throw new Error('Resolved SecurityPoolForkSnapshot has an unexpected dispute drain')
		return
	}
	if (event.escalationSnapshotId === zeroHash) throw new Error('Unresolved SecurityPoolForkSnapshot has a zero escalation snapshot id')
	if (working.forkSnapshotIds.has(snapshotKey)) throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} is duplicated`)
	const drain = working.drainByTransactionAndPool.get(transactionPoolIdentity(event))
	if (drain === undefined) throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} has no preceding same-transaction dispute drain`)
	if (drain.amountAttoRep !== event.escalationSourceRepAtForkAttoRep) {
		throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} escalation REP does not match its dispute drain`)
	}
	const sourceRep = BigInt(event.escalationSourceRepAtForkAttoRep)
	const childRep = BigInt(event.escalationChildRepAtForkAttoRep)
	if ((!event.ownFork && childRep !== sourceRep) || (event.ownFork && childRep >= sourceRep)) {
		throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} child escalation REP does not match its fork mode`)
	}
	const source = ensureReplayGame(working, drain.sourceGame, event.pool)
	const directClaimBaselineAttoRep: CarryTriple<CanonicalUintString> = [directClaimTotal(working, source.game, 0).toString(), directClaimTotal(working, source.game, 1).toString(), directClaimTotal(working, source.game, 2).toString()]
	if (directClaimBaselineAttoRep.some(amount => amount !== '0')) throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} follows a direct claim for its source game`)
	reserveDerivedReplayCost(working, CARRY_PROOF_REPLAY_GAME_BASE_COST + carryGameStateRecordCount(source.accumulator.state))
	const authenticatedSnapshotState = authenticateForkSnapshotAccounting(event, source, working)
	working.drainByTransactionAndPool.delete(transactionPoolIdentity(event))
	working.forkSnapshotIds.add(snapshotKey)
	context.forkSourceStateBySnapshotId.set(snapshotKey, {
		directClaimBaselineAttoRep,
		sourceGame: source.game,
		sourcePool: source.pool,
		state: authenticatedSnapshotState,
	})
	context.checkpointSnapshotCount += 1
}

function processCheckpoint(event: ForkCarryCheckpointJournalEvent, context: ReplayContext, working: ReplayWorkingSet) {
	const checkpoint = checkpointFromEvent(event)
	validateCarryCheckpoint(checkpoint)
	const sourceSnapshot = context.forkSourceStateBySnapshotId.get(event.snapshotId.toLowerCase())
	if (sourceSnapshot === undefined) throw new Error(`ForkCarryCheckpoint ${event.snapshotId} has no canonical SecurityPoolForkSnapshot source marker`)
	if (sourceSnapshot.sourceGame.toLowerCase() !== event.sourceGame.toLowerCase() || sourceSnapshot.sourcePool.toLowerCase() !== event.sourcePool.toLowerCase()) {
		throw new Error(`ForkCarryCheckpoint ${event.snapshotId} does not match its canonical source game and pool`)
	}
	const source = working.games.get(event.sourceGame.toLowerCase())
	if (source === undefined) throw new Error(`ForkCarryCheckpoint ${event.snapshotId} has no replayed source game`)
	const gameKey = event.emitter.toLowerCase()
	if (working.games.has(gameKey)) throw new Error(`ForkCarryCheckpoint target game ${event.emitter} was already initialized`)
	let accumulator: CarryProofAccumulator
	const retainedAccumulatorCost = inheritedCarryAccumulatorReplayCost(sourceSnapshot.state)
	const constructionCost = carryAccumulatorReplayCost(sourceSnapshot.state) + retainedAccumulatorCost * 2
	reserveDerivedReplayCost(working, constructionCost)
	try {
		accumulator = initializeCarryProofAccumulatorFromCheckpoint(event.emitter, event.pool, checkpoint, {
			game: sourceSnapshot.sourceGame,
			state: sourceSnapshot.state,
		})
	} catch (error) {
		releaseDerivedReplayCost(working, constructionCost)
		if (error instanceof Error) throw new Error(`ForkCarryCheckpoint ${event.snapshotId} does not match the source state captured at its canonical fork marker: ${error.message}`)
		throw error
	}
	releaseDerivedReplayCost(working, constructionCost - retainedAccumulatorCost)
	const replayGame: ReplayGameInternal = {
		accumulator,
		claimRetention: {
			exponent: source.claimRetention.exponent,
			mantissa: source.claimRetention.mantissa,
			rootSourceGame: source.claimRetention.rootSourceGame ?? source.game,
		},
		directClaimBaselineAttoRep: sourceSnapshot.directClaimBaselineAttoRep,
		game: event.emitter,
		haircut: null,
		localUnresolvedTotalsAttoRep: ['0', '0', '0'],
		pool: event.pool,
		rawAccounting: {
			inheritedTotalsAttoRep: [event.unresolvedTotalsAttoRep[0], event.unresolvedTotalsAttoRep[1], event.unresolvedTotalsAttoRep[2]],
			localTotalsAttoRep: ['0', '0', '0'],
		},
		snapshotId: event.snapshotId,
		sourceGame: event.sourceGame,
	}
	working.games.set(gameKey, replayGame)
	registerContinuationGame(working, replayGame)
	synchronizeReplayGameAccounting(working, replayGame)
}

function emptyWorkingSet(): ReplayWorkingSet {
	return {
		claimIdentities: new Set(),
		consumptionByClaimIdentity: new Map(),
		consumptionDispositions: new Map(),
		continuationGamesBySourceGame: new Map(),
		directClaimEvidence: new Map(),
		directClaims: new Map(),
		directClaimTotalsBySourceOutcome: new Map(),
		drainByTransactionAndPool: new Map(),
		forkSnapshotIds: new Set(),
		forkSnapshotPools: new Set(),
		games: new Map(),
		derivedReplayCost: 0,
		lastLocalNodeIdByGame: new Map(),
		localNodeIdentities: new Set(),
	}
}

function initializeReplayFromCheckpoint(checkpoint: CarryProofJournalCheckpoint | undefined, context: ReplayContext, working: ReplayWorkingSet) {
	if (checkpoint === undefined) return
	context.checkpointSnapshotCount = Number(checkpoint.checkpointSnapshotCount)
	const directClaimProofNodes = checkpoint.directClaimEvidence.reduce((count, evidence) => count + evidence.claimWitness.siblings.length + evidence.consumptionWitness.siblings.length, 0)
	reserveDerivedReplayCost(working, checkpoint.prefixEventMmr.peaks.length + checkpoint.directClaimMmr.peaks.length + directClaimProofNodes + checkpoint.consumptionDispositions.length + checkpoint.forkSnapshotIds.length + checkpoint.forkSnapshotPools.length + checkpoint.lastLocalNodeIds.length)
	for (const game of checkpoint.games) {
		reserveDerivedReplayCost(working, carryAccumulatorReplayCost(game.state))
		const accumulator = createCarryProofAccumulator(game.game, game.pool, game.state)
		const replayGame: ReplayGameInternal = {
			accumulator,
			claimRetention: {
				exponent: game.claimRetention.exponent,
				mantissa: game.claimRetention.mantissa,
				rootSourceGame: game.claimRetention.rootSourceGame,
			},
			directClaimBaselineAttoRep: game.directClaimBaselineAttoRep,
			game: game.game,
			haircut: game.haircut,
			localUnresolvedTotalsAttoRep: [game.localUnresolvedTotalsAttoRep[0], game.localUnresolvedTotalsAttoRep[1], game.localUnresolvedTotalsAttoRep[2]],
			pool: game.pool,
			rawAccounting: game.rawAccounting,
			...(game.source === null ? {} : { snapshotId: game.source.snapshotId, sourceGame: game.source.game }),
		}
		working.games.set(game.game.toLowerCase(), replayGame)
		registerContinuationGame(working, replayGame)
	}
	for (const disposition of checkpoint.consumptionDispositions) working.consumptionDispositions.set(consumptionDispositionIdentity(disposition.game, disposition.outcome, disposition.parentDepositIndex), { ...disposition })
	for (const evidence of checkpoint.directClaimEvidence) {
		addDirectClaim(working, directClaimFromEvidence(evidence), false)
		addDirectClaimEvidence(working, evidence)
	}
	for (const game of working.games.values()) {
		if (game.rawAccounting === null) continue
		const actual = carryProofAccumulatorAccounting(game.accumulator)
		const expected = effectiveReplayGameAccounting(working, game)
		if (stableJson(actual, `Compacted carry game ${game.game} accounting`) !== stableJson(expected, `Expected compacted carry game ${game.game} accounting`)) {
			throw new Error(`Compacted carry game ${game.game} accounting is not derivable from raw carry, direct claims, and its haircut`)
		}
	}
	for (const snapshotId of checkpoint.forkSnapshotIds) working.forkSnapshotIds.add(snapshotId.toLowerCase())
	for (const pool of checkpoint.forkSnapshotPools) working.forkSnapshotPools.add(pool.toLowerCase())
	for (const snapshot of checkpoint.pendingSourceSnapshots) {
		reserveDerivedReplayCost(working, CARRY_PROOF_REPLAY_GAME_BASE_COST + carryGameStateRecordCount(snapshot.state))
		context.forkSourceStateBySnapshotId.set(snapshot.snapshotId.toLowerCase(), {
			directClaimBaselineAttoRep: snapshot.directClaimBaselineAttoRep,
			sourceGame: snapshot.sourceGame,
			sourcePool: snapshot.sourcePool,
			state: snapshot.state,
		})
	}
	for (const entry of checkpoint.lastLocalNodeIds) working.lastLocalNodeIdByGame.set(entry.game.toLowerCase(), BigInt(entry.nodeId))
}

function processJournalEvent(event: CarryProofJournalEvent, context: ReplayContext, working: ReplayWorkingSet) {
	if (event.kind === 'local-deposit-appended') processLocalDeposit(event, working)
	else if (event.kind === 'carry-deposit-consumed') processCarryConsumption(event, working)
	else if (event.kind === 'claim-deposit') processClaim(event, working)
	else if (event.kind === 'truth-auction-haircut') processHaircut(event, working)
	else if (event.kind === 'dispute-staked-rep-drained-at-fork') processForkDrain(event, context.securityPoolForker, working)
	else if (event.kind === 'security-pool-fork-snapshot') processForkSnapshot(event, context, working)
	else processCheckpoint(event, context, working)
}

function replayJournalWorkingSet(journal: CarryProofJournal) {
	const context: ReplayContext = {
		checkpointSnapshotCount: 0,
		forkSourceStateBySnapshotId: new Map(),
		securityPoolForker: journal.securityPoolForker,
	}
	const working = emptyWorkingSet()
	initializeReplayFromCheckpoint(journal.checkpoint, context, working)
	for (const event of journal.events) processJournalEvent(event, context, working)
	for (const [identity, consumption] of working.consumptionByClaimIdentity) {
		if ((consumption.reason === 0 || consumption.reason === 3) && !working.claimIdentities.has(identity)) {
			throw new Error(`Carry consumption ${identity} reason ${consumption.reason.toString()} is missing its same-transaction ClaimDeposit`)
		}
	}
	if (working.drainByTransactionAndPool.size !== 0) throw new Error('Carry proof journal contains a dispute drain without its same-transaction fork snapshot')
	return { context, working }
}

function releaseReplayWorkingSet(context: ReplayContext, working: ReplayWorkingSet) {
	context.forkSourceStateBySnapshotId.clear()
	working.claimIdentities.clear()
	working.consumptionByClaimIdentity.clear()
	working.consumptionDispositions.clear()
	working.continuationGamesBySourceGame.clear()
	working.directClaimEvidence.clear()
	working.directClaims.clear()
	working.directClaimTotalsBySourceOutcome.clear()
	working.drainByTransactionAndPool.clear()
	working.forkSnapshotIds.clear()
	working.forkSnapshotPools.clear()
	working.games.clear()
	working.lastLocalNodeIdByGame.clear()
	working.localNodeIdentities.clear()
}

function truthAuctionHaircutAccountingForReplayGame(working: ReplayWorkingSet, replayed: ReplayGameInternal, repBeforeAttoRep: CanonicalUintString, repRemainingAttoRep: CanonicalUintString) {
	if (replayed.sourceGame === undefined || replayed.snapshotId === undefined || replayed.rawAccounting === null) {
		throw new Error(`Truth-auction haircut game ${replayed.game} is not a fork continuation`)
	}
	const effectiveUnresolved: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = ['0', '0', '0']
	for (const outcome of [0, 1, 2] as const) {
		const inherited = BigInt(replayed.rawAccounting.inheritedTotalsAttoRep[outcome])
		const directlyClaimed = directClaimDelta(working, replayed, outcome)
		if (directlyClaimed > inherited) throw new Error(`Truth-auction haircut outcome ${outcome.toString()} directly claimed principal exceeds inherited REP`)
		effectiveUnresolved[outcome] = (inherited - directlyClaimed + BigInt(replayed.rawAccounting.localTotalsAttoRep[outcome])).toString()
	}
	return deriveTruthAuctionHaircutAccounting(
		{
			resolutionBalancesAttoRep: carryProofAccumulatorAccounting(replayed.accumulator).resolutionBalancesAttoRep,
			unresolvedTotalsAttoRep: effectiveUnresolved,
		},
		replayed.localUnresolvedTotalsAttoRep,
		repBeforeAttoRep,
		repRemainingAttoRep,
	)
}

function truthAuctionHaircutAccountingFromWorkingSet(working: ReplayWorkingSet, parameters: { game: Address; pool: Address; repBeforeAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString }) {
	const gameAddress = getAddress(parameters.game)
	const poolAddress = getAddress(parameters.pool)
	const replayed = working.games.get(gameAddress.toLowerCase())
	if (replayed !== undefined && replayed.pool.toLowerCase() !== poolAddress.toLowerCase()) {
		throw new Error(`Carry game ${gameAddress} was associated with a different pool before its truth-auction haircut`)
	}
	if (replayed === undefined) throw new Error(`Truth-auction haircut game ${gameAddress} is not a fork continuation`)
	return truthAuctionHaircutAccountingForReplayGame(working, replayed, parameters.repBeforeAttoRep, parameters.repRemainingAttoRep)
}

/** Maintains one bounded replay while a canonical log page is decoded. */
export function createCarryProofJournalIncrementalReplay(journal: CarryProofJournal) {
	const normalized = normalizeJournal(journal)
	const { context, working } = replayJournalWorkingSet(normalized)
	let released = false
	const requireActive = () => {
		if (released) throw new Error('Carry proof journal incremental replay has been released')
	}
	return {
		append(event: CarryProofJournalEvent) {
			requireActive()
			processJournalEvent(event, context, working)
		},
		deriveTruthAuctionHaircutAccounting(parameters: { game: Address; pool: Address; repBeforeAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString }) {
			requireActive()
			return truthAuctionHaircutAccountingFromWorkingSet(working, parameters)
		},
		release() {
			if (released) return
			released = true
			releaseReplayWorkingSet(context, working)
		},
	}
}

function replayNormalizedJournal(journal: CarryProofJournal, wallet: Address | undefined, output: 'full' | 'states' | 'validate', maximumProofCandidates?: number, proofCandidatePage = 0n): Omit<CarryProofReplayResult, 'journalDigest'> {
	if (maximumProofCandidates !== undefined && (!Number.isSafeInteger(maximumProofCandidates) || maximumProofCandidates < 0)) {
		throw new Error('Maximum carry proof candidates must be a nonnegative safe integer')
	}
	if (proofCandidatePage < 0n) throw new Error('Carry proof candidate page must be nonnegative')
	const { context, working } = replayJournalWorkingSet(journal)
	const normalizedWallet = wallet === undefined ? undefined : getAddress(wallet)
	const games: Record<string, ReplayedCarryGame> = {}
	const proofCandidateSlots: Array<{ claimSourceGame: Address; game: ReplayGameInternal; outcome: CarryOutcome; slot: CarryLeafSlot }> = []
	for (const game of working.games.values()) {
		if (output === 'full' && game.sourceGame !== undefined && game.snapshotId !== undefined) {
			for (const outcome of [0, 1, 2] as const) {
				for (const slot of carryProofAccumulatorSnapshotSlots(game.accumulator, outcome)) {
					if (slot.hash === zeroHash || slot.consumedLocally) continue
					if (normalizedWallet !== undefined && slot.leaf.depositor.toLowerCase() !== normalizedWallet.toLowerCase()) continue
					if (carryProofAccumulatorIsNullified(game.accumulator, outcome, slot.leaf.parentDepositIndex)) continue
					const claimSourceGame = proofClaimSourceGame(game, slot.leaf.parentDepositIndex)
					if (working.directClaims.has(directClaimIdentity(claimSourceGame, outcome, slot.leaf.parentDepositIndex))) continue
					reserveDerivedReplayCost(working, 1)
					proofCandidateSlots.push({ claimSourceGame, game, outcome, slot })
				}
			}
		}
		if (output !== 'validate') {
			reserveDerivedReplayCost(working, carryGameStateRecordCount(game.accumulator.state))
			const state = materializeCarryProofAccumulatorState(game.accumulator)
			const localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString> = [game.localUnresolvedTotalsAttoRep[0], game.localUnresolvedTotalsAttoRep[1], game.localUnresolvedTotalsAttoRep[2]]
			const common = {
				game: game.game,
				localUnresolvedTotalsAttoRep,
				pool: game.pool,
				rawAccounting:
					game.rawAccounting === null
						? null
						: {
								inheritedTotalsAttoRep: carryTriple(game.rawAccounting.inheritedTotalsAttoRep[0], game.rawAccounting.inheritedTotalsAttoRep[1], game.rawAccounting.inheritedTotalsAttoRep[2]),
								localTotalsAttoRep: carryTriple(game.rawAccounting.localTotalsAttoRep[0], game.rawAccounting.localTotalsAttoRep[1], game.rawAccounting.localTotalsAttoRep[2]),
							},
				state,
			}
			games[game.game.toLowerCase()] = game.sourceGame === undefined || game.snapshotId === undefined ? common : { ...common, snapshotId: game.snapshotId, sourceGame: game.sourceGame }
		}
	}
	proofCandidateSlots.sort((left, right) => {
		const gameOrder = left.game.game.toLowerCase().localeCompare(right.game.game.toLowerCase())
		if (gameOrder !== 0) return gameOrder
		if (left.outcome !== right.outcome) return left.outcome - right.outcome
		const leftParent = BigInt(left.slot.leaf.parentDepositIndex)
		const rightParent = BigInt(right.slot.leaf.parentDepositIndex)
		if (leftParent < rightParent) return -1
		if (leftParent > rightParent) return 1
		return 0
	})
	reserveDerivedReplayCost(working, proofCandidateSlots.length)
	const proofCandidatePresence: CarryProofCandidatePresence[] = proofCandidateSlots.map(({ claimSourceGame, game, outcome, slot }) => {
		if (game.sourceGame === undefined) throw new Error(`Carry proof candidate game ${game.game} is missing source metadata`)
		return {
			claimSourceGame,
			game: game.game,
			outcome,
			parentDepositIndex: slot.leaf.parentDepositIndex,
			pool: game.pool,
			sourceGame: game.sourceGame,
			sourceNodeId: slot.leaf.sourceNodeId,
		}
	})
	let boundedProofSlots = proofCandidateSlots
	if (maximumProofCandidates !== undefined) {
		const count = Math.min(maximumProofCandidates, proofCandidateSlots.length)
		const offset = count === 0 ? 0 : Number((proofCandidatePage * BigInt(maximumProofCandidates)) % BigInt(proofCandidateSlots.length))
		reserveDerivedReplayCost(working, count)
		boundedProofSlots = Array.from({ length: count }, (_, index) => {
			const slot = proofCandidateSlots[(offset + index) % proofCandidateSlots.length]
			if (slot === undefined) throw new Error('Bounded carry proof page lost a canonical candidate')
			return slot
		})
	}
	reserveDerivedReplayCost(working, boundedProofSlots.length * (CARRY_MMR_MAXIMUM_PEAKS + CARRY_NULLIFIER_DEPTH + 4))
	const proofCandidates: CarryProofCandidate[] = boundedProofSlots.map(({ claimSourceGame, game, outcome, slot }) => {
		if (game.sourceGame === undefined || game.snapshotId === undefined) throw new Error(`Carry proof candidate game ${game.game} is missing source metadata`)
		return {
			amountAttoRep: slot.leaf.amountAttoRep,
			claimSourceGame,
			depositor: slot.leaf.depositor,
			game: game.game,
			outcome,
			parentDepositIndex: slot.leaf.parentDepositIndex,
			pool: game.pool,
			proof: createCarriedDepositProofFromAccumulator(game.accumulator, outcome, slot.leaf.parentDepositIndex, slot.leaf.sourceNodeId),
			snapshotId: game.snapshotId,
			sourceGame: game.sourceGame,
			sourceNodeId: slot.leaf.sourceNodeId,
		}
	})
	const instrumentation: CarryProofReplayInstrumentation = {
		accumulatorBuildSlotVisits: 0,
		accumulatorCount: working.games.size,
		fullStateMaterializations: 0,
		materializedSlotVisits: 0,
		mmrHashOperations: 0,
		nullifierHashOperations: 0,
		proofNodeReads: 0,
		streamingMutationCount: 0,
	}
	for (const game of working.games.values()) {
		const counters = game.accumulator.instrumentation
		instrumentation.accumulatorBuildSlotVisits += counters.accumulatorBuildSlotVisits
		instrumentation.fullStateMaterializations += counters.fullStateMaterializations
		instrumentation.materializedSlotVisits += counters.materializedSlotVisits
		instrumentation.mmrHashOperations += counters.mmrHashOperations
		instrumentation.nullifierHashOperations += counters.nullifierHashOperations
		instrumentation.proofNodeReads += counters.proofNodeReads
		instrumentation.streamingMutationCount += counters.streamingMutationCount
	}
	reserveDerivedReplayCost(working, working.directClaims.size)
	const directlyClaimedDeposits = [...working.directClaims.values()].sort((left, right) => directClaimIdentity(left.sourceGame, left.outcome, left.parentDepositIndex).localeCompare(directClaimIdentity(right.sourceGame, right.outcome, right.parentDepositIndex)))
	return {
		checkpointSnapshotCount: context.checkpointSnapshotCount,
		directlyClaimedDeposits,
		games,
		instrumentation,
		proofCandidates,
		proofCandidateCount: proofCandidateSlots.length,
		proofCandidatePresence,
	}
}

export function replayCarryProofJournal(journal: CarryProofJournal, wallet?: Address, maximumProofCandidates = CARRY_PROOF_JOURNAL_MAXIMUM_PROOF_CANDIDATES, proofCandidatePage?: bigint) {
	const normalized = normalizeJournal(journal)
	const replay = replayNormalizedJournal(normalized, wallet, 'full', maximumProofCandidates, proofCandidatePage)
	return { ...replay, journalDigest: carryProofJournalDigestFromNormalized(normalized) }
}

export function deriveTruthAuctionHaircutJournalEventAccounting(journal: CarryProofJournal, parameters: { game: Address; pool: Address; repBeforeAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString }) {
	return truthAuctionHaircutAccountingFromWorkingSet(replayJournalWorkingSet(normalizeJournal(journal)).working, parameters)
}

export function validateCarryProofJournal(journal: CarryProofJournal) {
	const normalized = normalizeJournal(journal)
	replayNormalizedJournal(normalized, undefined, 'validate')
	return normalized
}

type MutableDirectClaimEvidence = ReplayDirectClaimEvidence

interface EventMmrWitnessReference {
	evidence: MutableDirectClaimEvidence
	side: 'claim' | 'consumption'
}

interface MutableEventMmrNode {
	root: Hash
	witnesses: EventMmrWitnessReference[]
}

function eventLogIdentity(event: CarryProofJournalEvent) {
	return `${event.position.transactionHash.toLowerCase()}:${event.position.logIndex}`
}

function witnessFor(reference: EventMmrWitnessReference) {
	return reference.side === 'claim' ? reference.evidence.claimWitness : reference.evidence.consumptionWitness
}

function installWitness(reference: EventMmrWitnessReference, witness: CarryJournalEventMmrWitness) {
	if (reference.side === 'claim') reference.evidence.claimWitness = witness
	else reference.evidence.consumptionWitness = witness
}

function eventForWitness(reference: EventMmrWitnessReference) {
	return reference.side === 'claim' ? reference.evidence.claim : reference.evidence.consumption
}

function projectedEventMmrProofNodeCount(priorLeafCount: bigint, events: readonly CarryProofJournalEvent[], directClaimEvidence: readonly ReplayDirectClaimEvidence[]) {
	const finalLeafCount = priorLeafCount + BigInt(events.length)
	if (finalLeafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES) throw new Error('Carry event MMR exceeds its leaf capacity')
	const suffixLeafIndexByLog = new Map<string, bigint>()
	for (const [index, event] of events.entries()) suffixLeafIndexByLog.set(eventLogIdentity(event), priorLeafCount + BigInt(index))
	let proofNodes = 0
	for (const evidence of directClaimEvidence) {
		const entries = [
			{ event: evidence.consumption, witness: evidence.consumptionWitness },
			{ event: evidence.claim, witness: evidence.claimWitness },
		]
		for (const entry of entries) {
			const leafIndex = entry.witness === undefined ? suffixLeafIndexByLog.get(eventLogIdentity(entry.event)) : BigInt(entry.witness.leafIndex)
			if (leafIndex === undefined) throw new Error('Direct-claim evidence is absent from the canonical journal suffix')
			proofNodes += eventMmrPeakForLeaf(finalLeafCount, leafIndex).height
		}
	}
	return proofNodes
}

/** Extends the frontier without retaining historic leaves and updates only witnesses whose peaks merge. */
function extendEventMmr(
	identity: CarryProofJournalExpectedIdentity,
	prior: CarryJournalEventMmrAccumulator,
	events: readonly CarryProofJournalEvent[],
	directClaimEvidence: readonly ReplayDirectClaimEvidence[] = [],
): { accumulator: CarryJournalEventMmrAccumulator; directClaimEvidence: CarryJournalDirectClaimEvidence[] } {
	const oldLeafCount = BigInt(prior.leafCount)
	const evidence: MutableDirectClaimEvidence[] = directClaimEvidence.map(entry => ({
		claim: { ...entry.claim, position: { ...entry.claim.position } },
		...(entry.claimWitness === undefined ? {} : { claimWitness: { leafIndex: entry.claimWitness.leafIndex, siblings: [...entry.claimWitness.siblings] } }),
		consumption: { ...entry.consumption, position: { ...entry.consumption.position } },
		...(entry.consumptionWitness === undefined ? {} : { consumptionWitness: { leafIndex: entry.consumptionWitness.leafIndex, siblings: [...entry.consumptionWitness.siblings] } }),
	}))
	const witnessesByPeak = new Map<number, EventMmrWitnessReference[]>()
	const newWitnessByLog = new Map<string, EventMmrWitnessReference>()
	for (const entry of evidence) {
		const references: EventMmrWitnessReference[] = [
			{ evidence: entry, side: 'consumption' },
			{ evidence: entry, side: 'claim' },
		]
		const hasClaimWitness = entry.claimWitness !== undefined
		const hasConsumptionWitness = entry.consumptionWitness !== undefined
		if (hasClaimWitness !== hasConsumptionWitness) throw new Error('Direct-claim evidence has an incomplete event MMR witness pair')
		for (const reference of references) {
			const witness = witnessFor(reference)
			if (witness === undefined) {
				const logIdentity = eventLogIdentity(eventForWitness(reference))
				if (newWitnessByLog.has(logIdentity)) throw new Error(`Direct-claim event MMR evidence log ${logIdentity} is duplicated`)
				newWitnessByLog.set(logIdentity, reference)
				continue
			}
			const selected = eventMmrPeakForLeaf(oldLeafCount, BigInt(witness.leafIndex))
			const referencesAtPeak = witnessesByPeak.get(selected.height)
			if (referencesAtPeak === undefined) witnessesByPeak.set(selected.height, [reference])
			else referencesAtPeak.push(reference)
		}
	}
	const peaks: Array<MutableEventMmrNode | undefined> = Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => undefined)
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((oldLeafCount >> BigInt(height)) & 1n) === 0n) continue
		const root = prior.peaks[height]
		if (root === undefined || root === zeroHash) throw new Error(`Carry event MMR prior peak ${height.toString()} is missing`)
		peaks[height] = { root, witnesses: witnessesByPeak.get(height) ?? [] }
	}
	let leafCount = oldLeafCount
	for (const event of events) {
		if (leafCount >= CARRY_EVENT_MMR_MAXIMUM_LEAVES - 1n) throw new Error('Carry event MMR exceeds its leaf capacity')
		const reference = newWitnessByLog.get(eventLogIdentity(event))
		const witnesses: EventMmrWitnessReference[] = []
		if (reference !== undefined) {
			if (stableJson(eventForWitness(reference), 'Expected direct-claim event MMR evidence') !== stableJson(event, 'Canonical direct-claim event MMR leaf')) {
				throw new Error('Direct-claim evidence event does not match its canonical journal suffix leaf')
			}
			installWitness(reference, { leafIndex: leafCount.toString(), siblings: [] })
			witnesses.push(reference)
			newWitnessByLog.delete(eventLogIdentity(event))
		}
		let node: MutableEventMmrNode = { root: eventMmrLeafHash(identity, leafCount, event), witnesses }
		let height = 0
		while (((leafCount >> BigInt(height)) & 1n) === 1n) {
			const left = peaks[height]
			if (left === undefined) throw new Error(`Carry event MMR peak ${height.toString()} is missing during append`)
			for (const leftReference of left.witnesses) {
				const witness = witnessFor(leftReference)
				if (witness === undefined) throw new Error('Carry event MMR left witness is missing during append')
				witness.siblings.push(node.root)
			}
			for (const rightReference of node.witnesses) {
				const witness = witnessFor(rightReference)
				if (witness === undefined) throw new Error('Carry event MMR right witness is missing during append')
				witness.siblings.push(left.root)
			}
			node = { root: eventMmrParentHash(left.root, node.root), witnesses: [...left.witnesses, ...node.witnesses] }
			peaks[height] = undefined
			height += 1
		}
		if (height >= CARRY_MMR_MAXIMUM_PEAKS) throw new Error('Carry event MMR is too tall')
		peaks[height] = node
		leafCount += 1n
	}
	if (newWitnessByLog.size !== 0) throw new Error('Direct-claim evidence is absent from the canonical journal suffix')
	const canonicalPeaks = peaks.map(peak => peak?.root ?? zeroHash)
	const accumulator: CarryJournalEventMmrAccumulator = {
		leafCount: leafCount.toString(),
		peaks: canonicalPeaks,
		root: eventMmrRoot(identity, leafCount, canonicalPeaks),
	}
	const persistedEvidence = evidence.map((entry): CarryJournalDirectClaimEvidence => {
		if (entry.claimWitness === undefined || entry.consumptionWitness === undefined) throw new Error('Direct-claim evidence is missing its canonical event MMR witness')
		return {
			claim: entry.claim,
			claimWitness: entry.claimWitness,
			consumption: entry.consumption,
			consumptionWitness: entry.consumptionWitness,
		}
	})
	return { accumulator, directClaimEvidence: persistedEvidence }
}

export function shouldCompactCarryProofJournal(journal: CarryProofJournal) {
	return journal.events.length >= CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD
}

/**
 * Replaces every validated event through the current finalized cursor with an
 * authenticated replay checkpoint. Events observed after this cutover remain
 * as the naturally short suffix until the next threshold is reached.
 */
function compactNormalizedCarryProofJournal(normalized: CarryProofJournal, assertedRawAccountingByGame?: Readonly<Record<string, CarryJournalRawAccounting>>) {
	if (normalized.events.length === 0) return normalized
	const { context, working } = replayJournalWorkingSet(normalized)
	const journalIdentity = expectedIdentity(normalized)
	const replayDirectClaimEvidence = [...working.directClaimEvidence.values()].sort((left, right) => directClaimIdentity(left.claim.emitter, left.claim.outcome, left.claim.parentDepositIndex).localeCompare(directClaimIdentity(right.claim.emitter, right.claim.outcome, right.claim.parentDepositIndex)))
	reserveDerivedReplayCost(working, normalized.events.length)
	const directClaimProofNodes = projectedEventMmrProofNodeCount(BigInt(normalized.checkpoint?.prefixEventMmr.leafCount ?? 0), normalized.events, replayDirectClaimEvidence)
	releaseDerivedReplayCost(working, normalized.events.length)
	reserveDerivedReplayCost(
		working,
		working.games.size +
			context.forkSourceStateBySnapshotId.size +
			working.consumptionDispositions.size +
			CARRY_MMR_MAXIMUM_PEAKS * 2 +
			working.directClaimEvidence.size * 6 +
			directClaimProofNodes +
			working.directClaims.size +
			working.forkSnapshotIds.size +
			working.forkSnapshotPools.size +
			working.lastLocalNodeIdByGame.size,
	)
	const eventMmrExtension = extendEventMmr(journalIdentity, normalized.checkpoint?.prefixEventMmr ?? emptyEventMmrAccumulator(journalIdentity), normalized.events, replayDirectClaimEvidence)
	const directClaimMmr = buildDirectClaimMmr(journalIdentity, eventMmrExtension.directClaimEvidence)
	const games = [...working.games.values()]
		.map(game => {
			const sourceSnapshot = game.snapshotId === undefined ? undefined : context.forkSourceStateBySnapshotId.get(game.snapshotId.toLowerCase())
			if ((game.sourceGame === undefined || game.snapshotId === undefined) !== (sourceSnapshot === undefined)) throw new Error(`Carry game ${game.game} has incomplete compacted source metadata`)
			const source = game.sourceGame === undefined || game.snapshotId === undefined || sourceSnapshot === undefined ? null : { game: game.sourceGame, pool: sourceSnapshot.sourcePool, snapshotId: game.snapshotId }
			let rawAccounting: CarryJournalRawAccounting | null = null
			if (source !== null) {
				if (game.rawAccounting === null) throw new Error(`Raw carry accounting for ${game.game} is missing before carry-journal compaction`)
				rawAccounting = {
					inheritedTotalsAttoRep: carryTriple(game.rawAccounting.inheritedTotalsAttoRep[0], game.rawAccounting.inheritedTotalsAttoRep[1], game.rawAccounting.inheritedTotalsAttoRep[2]),
					localTotalsAttoRep: carryTriple(game.rawAccounting.localTotalsAttoRep[0], game.rawAccounting.localTotalsAttoRep[1], game.rawAccounting.localTotalsAttoRep[2]),
				}
			}
			if (source !== null && assertedRawAccountingByGame !== undefined) {
				const asserted = assertedRawAccountingByGame[game.game.toLowerCase()]
				if (asserted === undefined) throw new Error(`Raw carry accounting for ${game.game} is required before carry-journal compaction`)
				if (game.rawAccounting === null || stableJson(parseCheckpointRawAccounting(asserted, `Raw carry accounting for ${game.game}`), 'Asserted raw carry accounting') !== stableJson(game.rawAccounting, 'Replayed raw carry accounting')) {
					throw new Error(`Raw carry accounting for ${game.game} differs from canonical event-time replay`)
				}
			}
			reserveDerivedReplayCost(working, carryGameStateRecordCount(game.accumulator.state))
			return {
				claimRetention: {
					exponent: game.claimRetention.exponent,
					mantissa: game.claimRetention.mantissa,
					rootSourceGame: game.claimRetention.rootSourceGame,
				},
				directClaimBaselineAttoRep: game.directClaimBaselineAttoRep === null ? null : carryTriple(game.directClaimBaselineAttoRep[0], game.directClaimBaselineAttoRep[1], game.directClaimBaselineAttoRep[2]),
				game: game.game,
				haircut: game.haircut,
				localUnresolvedTotalsAttoRep: carryTriple(game.localUnresolvedTotalsAttoRep[0], game.localUnresolvedTotalsAttoRep[1], game.localUnresolvedTotalsAttoRep[2]),
				pool: game.pool,
				rawAccounting,
				source,
				state: materializeCarryProofAccumulatorState(game.accumulator),
			}
		})
		.sort((left, right) => left.game.toLowerCase().localeCompare(right.game.toLowerCase()))
	const pendingSourceSnapshots = [...context.forkSourceStateBySnapshotId.entries()]
		.map(([snapshotId, snapshot]) => ({
			directClaimBaselineAttoRep: carryTriple(snapshot.directClaimBaselineAttoRep[0], snapshot.directClaimBaselineAttoRep[1], snapshot.directClaimBaselineAttoRep[2]),
			snapshotId: hash(snapshotId, 'Compacted carry source snapshot id'),
			sourceGame: snapshot.sourceGame,
			sourcePool: snapshot.sourcePool,
			state: snapshot.state,
		}))
		.sort((left, right) => left.snapshotId.toLowerCase().localeCompare(right.snapshotId.toLowerCase()))
	const consumptionDispositions = [...working.consumptionDispositions.values()].sort((left, right) => consumptionDispositionIdentity(left.game, left.outcome, left.parentDepositIndex).localeCompare(consumptionDispositionIdentity(right.game, right.outcome, right.parentDepositIndex)))
	const forkSnapshotIds = [...working.forkSnapshotIds].map(snapshotId => hash(snapshotId, 'Compacted fork snapshot id')).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
	const forkSnapshotPools = [...working.forkSnapshotPools].map(pool => address(pool, 'Compacted fork snapshot pool')).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
	const lastLocalNodeIds = [...working.lastLocalNodeIdByGame.entries()].map(([game, nodeId]) => ({ game: address(game, 'Compacted carry game'), nodeId: nodeId.toString() })).sort((left, right) => left.game.toLowerCase().localeCompare(right.game.toLowerCase()))
	const checkpoint: CarryProofJournalCheckpoint = {
		checkpointSnapshotCount: BigInt(context.checkpointSnapshotCount).toString(),
		consumptionDispositions,
		cutoff: { ...normalized.cursor },
		directClaimEvidence: eventMmrExtension.directClaimEvidence,
		directClaimMmr,
		forkSnapshotIds,
		forkSnapshotPools,
		games,
		lastLocalNodeIds,
		pendingSourceSnapshots,
		prefixEventCount: eventMmrExtension.accumulator.leafCount,
		prefixEventDigest: prefixEventCommitment(journalIdentity, eventMmrExtension.accumulator, directClaimMmr),
		prefixEventMmr: eventMmrExtension.accumulator,
		schemaVersion: 3,
	}
	const compacted = { ...normalized, checkpoint, events: [] }
	releaseReplayWorkingSet(context, working)
	return validateCarryProofJournal(compacted)
}

export function compactCarryProofJournal(journal: CarryProofJournal, assertedRawAccountingByGame?: Readonly<Record<string, CarryJournalRawAccounting>>): CarryProofJournal {
	return compactNormalizedCarryProofJournal(validateCarryProofJournal(journal), assertedRawAccountingByGame)
}

/**
 * Appends one bounded canonical log response and compacts before the temporary
 * suffix can consume the durable resident envelope. The transient allowance is
 * limited to one scan response; the replay-derived checkpoint must still fit
 * the normal persisted record limit before this function returns.
 */
export function appendCarryProofJournalEventsWithCompaction(journal: CarryProofJournal, additions: readonly CarryProofJournalEvent[], cursor: CarryJournalCursor) {
	const current = normalizeJournal(journal)
	if (additions.length > CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS) {
		throw new Error(`Carry proof journal append exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS.toString()}-record transient safety limit`)
	}
	const projectedRecords = carryProofJournalResidentRecords(current) + additions.length
	if (projectedRecords <= CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS) {
		const appended = appendedCarryProofJournal(current, additions, cursor)
		return shouldCompactCarryProofJournal(appended) ? compactNormalizedCarryProofJournal(appended) : appended
	}
	const transientMaximum = CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS + CARRY_PROOF_JOURNAL_MAXIMUM_TRANSIENT_APPEND_RECORDS
	const appended = appendedCarryProofJournal(current, additions, cursor, transientMaximum)
	return compactNormalizedCarryProofJournal(appended)
}

function stableJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableJsonValue)
	if (!isRecord(value)) return value
	const sorted: Record<string, unknown> = {}
	for (const key of Object.keys(value).sort()) sorted[key] = stableJsonValue(value[key])
	return sorted
}

function stableJson(value: unknown, label: string) {
	const serialized = JSON.stringify(stableJsonValue(value))
	if (serialized === undefined) throw new Error(`${label} cannot be serialized`)
	return serialized
}

/**
 * Fixed-size quorum value binding deployment identity, cursor, event count,
 * and every canonical event. Events are hashed one at a time, avoiding a
 * recursive walk of the complete journal by the quorum serializer.
 */
function carryProofJournalDigestFromNormalized(normalized: CarryProofJournal) {
	const identity = expectedIdentity(normalized)
	const eventMmr = extendEventMmr(identity, normalized.checkpoint?.prefixEventMmr ?? emptyEventMmrAccumulator(identity), normalized.events).accumulator
	return keccak256(
		toHex(
			stableJson(
				{
					chainId: normalized.chainId,
					checkpointDigest: normalized.checkpoint === undefined ? zeroHash : keccak256(toHex(stableJson(normalized.checkpoint, 'Carry proof journal checkpoint digest'))),
					cursor: normalized.cursor,
					domain: JOURNAL_ENVELOPE_FORMAT,
					eventCount: eventMmr.leafCount,
					eventHistoryDigest: eventMmr.root,
					profileId: normalized.profileId,
					scanStarted: normalized.scanStarted,
					schemaVersion: normalized.schemaVersion,
					securityPoolForker: normalized.securityPoolForker,
					startBlock: normalized.startBlock,
				},
				'Carry proof journal digest header',
			),
		),
	)
}

export function carryProofJournalDigest(journal: CarryProofJournal) {
	const normalized = normalizeJournal(journal)
	replayNormalizedJournal(normalized, undefined, 'validate')
	return carryProofJournalDigestFromNormalized(normalized)
}

function journalChecksum(journal: CarryProofJournal) {
	return keccak256(toHex(stableJson(journal, 'Carry proof journal')))
}

function expectedIdentity(identity: CarryProofJournalIdentity | CarryProofJournal): CarryProofJournalExpectedIdentity {
	return {
		chainId: identity.chainId,
		profileId: identity.profileId,
		securityPoolForker: identity.securityPoolForker,
		startBlock: identity.startBlock,
	}
}

function assertExpectedIdentity(journal: CarryProofJournalExpectedIdentity, expected: CarryProofJournalExpectedIdentity) {
	if (journal.chainId !== expected.chainId) throw new CarryProofJournalIdentityMismatchError(`Carry proof journal belongs to chain ${journal.chainId.toString()}, expected ${expected.chainId.toString()}`)
	if (journal.profileId !== expected.profileId) throw new CarryProofJournalIdentityMismatchError('Carry proof journal belongs to a different deployment profile')
	if (journal.securityPoolForker.toLowerCase() !== expected.securityPoolForker.toLowerCase()) throw new CarryProofJournalIdentityMismatchError('Carry proof journal belongs to a different SecurityPoolForker')
	if (journal.startBlock !== expected.startBlock) throw new CarryProofJournalIdentityMismatchError('Carry proof journal has a different immutable start block')
}

function parseJournalPayload(value: unknown): CarryProofJournal {
	const journal = requiredRecord(value, 'carry proof journal')
	carryProofJournalResidentRecords(journal)
	const hasCheckpoint = Object.hasOwn(journal, 'checkpoint')
	exactKeys(journal, hasCheckpoint ? ['chainId', 'checkpoint', 'cursor', 'events', 'profileId', 'scanStarted', 'schemaVersion', 'securityPoolForker', 'startBlock'] : ['chainId', 'cursor', 'events', 'profileId', 'scanStarted', 'schemaVersion', 'securityPoolForker', 'startBlock'], 'carry proof journal')
	if (journal['schemaVersion'] !== CARRY_PROOF_JOURNAL_SCHEMA_VERSION) throw new Error('Carry proof journal schema version is unsupported')
	if (typeof journal['chainId'] !== 'number') throw new Error('carry proof journal.chainId must be a number')
	const cursorRecord = requiredRecord(journal['cursor'], 'carry proof journal.cursor')
	exactKeys(cursorRecord, ['blockHash', 'blockNumber'], 'carry proof journal.cursor')
	if (!Array.isArray(journal['events'])) throw new Error('carry proof journal.events must be an array')
	const parsedProfileId = profileId(journal['profileId'], 'carry proof journal.profileId')
	const parsedForker = address(stringField(journal, 'securityPoolForker', 'carry proof journal'), 'carry proof journal.securityPoolForker')
	const parsedStartBlock = stringField(journal, 'startBlock', 'carry proof journal')
	const journalIdentity: CarryProofJournalExpectedIdentity = { chainId: journal['chainId'], profileId: parsedProfileId, securityPoolForker: parsedForker, startBlock: parsedStartBlock }
	return normalizeJournal(
		{
			chainId: journal['chainId'],
			...(hasCheckpoint ? { checkpoint: parseCheckpoint(journal['checkpoint'], journalIdentity) } : {}),
			cursor: {
				blockHash: hash(stringField(cursorRecord, 'blockHash', 'carry proof journal.cursor'), 'carry proof journal.cursor.blockHash'),
				blockNumber: stringField(cursorRecord, 'blockNumber', 'carry proof journal.cursor'),
			},
			events: journal['events'].map((event, index) => parseCarryProofJournalEvent(event, index)),
			profileId: parsedProfileId,
			scanStarted: booleanField(journal, 'scanStarted', 'carry proof journal'),
			schemaVersion: CARRY_PROOF_JOURNAL_SCHEMA_VERSION,
			securityPoolForker: parsedForker,
			startBlock: parsedStartBlock,
		},
		CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS,
		true,
	)
}

function parseCarryProofJournalEnvelope(contents: string, expected?: CarryProofJournalExpectedIdentity, expectedResidentRecords?: number): CarryProofJournal {
	if (Buffer.byteLength(contents, 'utf8') > CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES) {
		throw new Error(`Carry proof journal exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES.toString()}-byte payload safety limit`)
	}
	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Carry proof journal is not valid JSON: ${error.message}`)
		throw error
	}
	const envelope = requiredRecord(value, 'carry proof journal envelope')
	exactKeys(envelope, ['checksum', 'format', 'journal'], 'carry proof journal envelope')
	if (envelope['format'] !== JOURNAL_ENVELOPE_FORMAT) throw new Error('Carry proof journal envelope format is unsupported')
	const checksum = hash(stringField(envelope, 'checksum', 'carry proof journal envelope'), 'carry proof journal envelope.checksum')
	if (expectedResidentRecords !== undefined) {
		const actualResidentRecords = carryProofJournalResidentRecords(envelope['journal'])
		if (actualResidentRecords !== expectedResidentRecords) throw new Error('Carry proof journal resident record count does not match its segmented manifest')
	}
	const journal = parseJournalPayload(envelope['journal'])
	const computedChecksum = journalChecksum(journal)
	if (checksum.toLowerCase() !== computedChecksum.toLowerCase()) throw new Error('Carry proof journal checksum does not match its payload')
	if (expected !== undefined) assertExpectedIdentity(journal, expected)
	replayNormalizedJournal(journal, undefined, 'validate')
	return journal
}

export function parseCarryProofJournal(contents: string, expected?: CarryProofJournalExpectedIdentity): CarryProofJournal {
	return parseCarryProofJournalEnvelope(contents, expected)
}

function serializeNormalizedCarryProofJournal(normalized: CarryProofJournal) {
	const envelope: JournalEnvelope = {
		checksum: journalChecksum(normalized),
		format: JOURNAL_ENVELOPE_FORMAT,
		journal: normalized,
	}
	const contents = `${JSON.stringify(envelope, undefined, 2)}\n`
	if (Buffer.byteLength(contents, 'utf8') > CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES) {
		throw new Error(`Carry proof journal exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES.toString()}-byte payload safety limit`)
	}
	return contents
}

export function serializedCarryProofJournal(journal: CarryProofJournal) {
	return serializeNormalizedCarryProofJournal(validateCarryProofJournal(journal))
}

export function carryProofJournalSidecarPath(runtimeStatePath: string) {
	if (runtimeStatePath.length === 0) throw new Error('Runtime state path is empty')
	return resolve(`${runtimeStatePath}.carry-proof-journal.json`)
}

function carryJournalSegmentDirectoryForSidecar(path: string) {
	return join(dirname(path), `carry-journal-${keccak256(toHex(basename(path))).slice(2)}-segments-v3`)
}

export function carryProofJournalSegmentDirectory(runtimeStatePath: string) {
	return carryJournalSegmentDirectoryForSidecar(carryProofJournalSidecarPath(runtimeStatePath))
}

function errorCode(error: unknown) {
	if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return undefined
	return error.code
}

async function readOwnerOnlyFile(path: string, subject: string, maximumBytes: number, expectedBytes?: number) {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isFile()) throw new Error(`${subject} ${path} must be a regular file`)
		if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${subject} ${path} must have owner-only mode 0600`)
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${subject} ${path} must be owned by the bot process user`)
		if (metadata.size > maximumBytes) throw new Error(`${subject} ${path} exceeds its ${maximumBytes.toString()}-byte safety limit`)
		if (expectedBytes !== undefined && metadata.size !== expectedBytes) throw new Error(`${subject} ${path} byte length does not match its manifest`)
		const contents = await handle.readFile()
		if (contents.byteLength > maximumBytes) throw new Error(`${subject} ${path} exceeds its ${maximumBytes.toString()}-byte safety limit`)
		if (expectedBytes !== undefined && contents.byteLength !== expectedBytes) throw new Error(`${subject} ${path} byte length does not match its manifest`)
		return contents
	} catch (error) {
		if (errorCode(error) === 'ELOOP') throw new Error(`${subject} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

async function assertOwnerOnlyDirectory(path: string, subject: string) {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isDirectory()) throw new Error(`${subject} ${path} must be a directory`)
		if ((metadata.mode & 0o777) !== 0o700) throw new Error(`${subject} ${path} must have owner-only mode 0700`)
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${subject} ${path} must be owned by the bot process user`)
	} catch (error) {
		if (errorCode(error) === 'ELOOP') throw new Error(`${subject} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

function payloadChecksum(payload: Uint8Array) {
	return keccak256(payload)
}

function segmentedManifestChecksum(payload: SegmentedJournalManifestPayload) {
	return keccak256(toHex(stableJson(payload, 'Segmented carry proof journal manifest')))
}

function parseSegmentedIdentity(value: unknown, label: string): CarryProofJournalExpectedIdentity {
	const record = requiredRecord(value, label)
	exactKeys(record, ['chainId', 'profileId', 'securityPoolForker', 'startBlock'], label)
	const chainId = record['chainId']
	if (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || chainId < 1) throw new Error(`${label}.chainId must be a positive safe integer`)
	const startBlock = stringField(record, 'startBlock', label)
	uintString(startBlock, `${label}.startBlock`)
	return {
		chainId,
		profileId: profileId(record['profileId'], `${label}.profileId`),
		securityPoolForker: address(stringField(record, 'securityPoolForker', label), `${label}.securityPoolForker`),
		startBlock,
	}
}

function parseSegmentedEnvelope(contents: string): SegmentedJournalEnvelope | undefined {
	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
	if (!isRecord(value)) return undefined
	if (value['format'] !== SEGMENTED_JOURNAL_ENVELOPE_FORMAT) {
		if (typeof value['format'] === 'string' && value['format'].startsWith('zoltar-chaos-carry-proof-journal-segmented-')) throw new Error('Segmented carry proof journal envelope format is unsupported')
		return undefined
	}
	const label = 'segmented carry proof journal envelope'
	exactKeys(value, ['format', 'identity', 'manifestChecksum', 'payloadBytes', 'payloadChecksum', 'residentRecords', 'segmentCount', 'segmentDirectory', 'segments'], label)
	const payloadBytes = stringField(value, 'payloadBytes', label)
	const payloadByteCount = positiveUint(payloadBytes, `${label}.payloadBytes`)
	if (payloadByteCount > BigInt(CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES)) throw new Error(`${label}.payloadBytes exceeds the aggregate payload safety limit`)
	const residentRecords = stringField(value, 'residentRecords', label)
	const residentRecordCount = uintString(residentRecords, `${label}.residentRecords`)
	if (residentRecordCount > BigInt(CARRY_PROOF_JOURNAL_MAXIMUM_RESIDENT_RECORDS)) throw new Error(`${label}.residentRecords exceeds the resident record safety limit`)
	const segmentsValue = value['segments']
	if (!Array.isArray(segmentsValue) || segmentsValue.length === 0) throw new Error(`${label}.segments must be a nonempty array`)
	const segmentCount = stringField(value, 'segmentCount', label)
	const declaredSegmentCount = positiveUint(segmentCount, `${label}.segmentCount`)
	if (declaredSegmentCount > BigInt(CARRY_PROOF_JOURNAL_MAXIMUM_SEGMENTS)) throw new Error(`${label}.segmentCount exceeds the segment-count safety limit`)
	if (declaredSegmentCount !== BigInt(segmentsValue.length)) throw new Error(`${label}.segmentCount does not match its descriptor array`)
	if (segmentsValue.length > CARRY_PROOF_JOURNAL_MAXIMUM_SEGMENTS) throw new Error(`${label}.segments exceeds the segment-count safety limit`)
	const expectedSegmentCount = Math.ceil(Number(payloadByteCount) / CARRY_PROOF_JOURNAL_SEGMENT_BYTES)
	if (segmentsValue.length !== expectedSegmentCount) throw new Error(`${label}.segments does not match its payload byte geometry`)
	const segmentDirectory = stringField(value, 'segmentDirectory', label)
	if (!CARRY_PROOF_JOURNAL_SEGMENT_DIRECTORY_PATTERN.test(segmentDirectory) || basename(segmentDirectory) !== segmentDirectory) {
		throw new Error(`${label}.segmentDirectory is not a canonical carry-journal segment directory`)
	}
	const files = new Set<string>()
	const segments: JournalSegmentDescriptor[] = []
	let declaredBytes = 0n
	for (let index = 0; index < segmentsValue.length; index += 1) {
		const entry = segmentsValue[index]
		const entryLabel = `${label}.segments[${index.toString()}]`
		const record = requiredRecord(entry, entryLabel)
		exactKeys(record, ['bytes', 'checksum', 'file'], entryLabel)
		const file = stringField(record, 'file', entryLabel)
		const expectedOrdinal = index.toString().padStart(8, '0')
		if (file.length > 255 || !CARRY_PROOF_JOURNAL_SEGMENT_FILE_PATTERN.test(file) || !file.endsWith(`.${expectedOrdinal}.part`) || basename(file) !== file) {
			throw new Error(`${entryLabel}.file is not a canonical carry-journal segment name for its ordinal`)
		}
		if (files.has(file)) throw new Error(`${label} contains duplicate segment ${file}`)
		files.add(file)
		const bytes = stringField(record, 'bytes', entryLabel)
		const byteCount = positiveUint(bytes, `${entryLabel}.bytes`)
		const expectedBytes = index + 1 === segmentsValue.length ? payloadByteCount - BigInt(index * CARRY_PROOF_JOURNAL_SEGMENT_BYTES) : BigInt(CARRY_PROOF_JOURNAL_SEGMENT_BYTES)
		if (byteCount !== expectedBytes) throw new Error(`${entryLabel}.bytes does not match the canonical segment geometry`)
		declaredBytes += byteCount
		segments.push({
			bytes,
			checksum: hash(stringField(record, 'checksum', entryLabel), `${entryLabel}.checksum`),
			file,
		})
	}
	if (declaredBytes !== payloadByteCount) throw new Error(`${label}.segments do not sum to payloadBytes`)
	const payload: SegmentedJournalManifestPayload = {
		format: SEGMENTED_JOURNAL_ENVELOPE_FORMAT,
		identity: parseSegmentedIdentity(value['identity'], `${label}.identity`),
		payloadBytes,
		payloadChecksum: hash(stringField(value, 'payloadChecksum', label), `${label}.payloadChecksum`),
		residentRecords,
		segmentCount,
		segmentDirectory,
		segments,
	}
	const manifestChecksum = hash(stringField(value, 'manifestChecksum', label), `${label}.manifestChecksum`)
	if (segmentedManifestChecksum(payload).toLowerCase() !== manifestChecksum.toLowerCase()) throw new Error('Segmented carry proof journal manifest checksum does not match its fields')
	return { ...payload, manifestChecksum }
}

async function readCarryProofJournalFile(path: string, expected?: CarryProofJournalExpectedIdentity, segmentDirectoryPath = carryJournalSegmentDirectoryForSidecar(path)) {
	const mainPayload = await readOwnerOnlyFile(path, 'Carry proof journal', CARRY_PROOF_JOURNAL_SEGMENT_BYTES)
	const contents = mainPayload.toString('utf8')
	const segmented = parseSegmentedEnvelope(contents)
	if (segmented === undefined) return parseCarryProofJournal(contents, expected)
	if (mainPayload.byteLength > CARRY_PROOF_JOURNAL_MANIFEST_BYTES) throw new Error(`Carry proof journal segmented manifest exceeds its ${CARRY_PROOF_JOURNAL_MANIFEST_BYTES.toString()}-byte safety limit`)
	if (expected !== undefined) assertExpectedIdentity(segmented.identity, expected)
	if (segmented.segmentDirectory !== basename(segmentDirectoryPath)) throw new Error('Carry proof journal segmented manifest belongs to a different segment directory')
	await assertOwnerOnlyDirectory(segmentDirectoryPath, 'Carry proof journal segment directory')
	const payload = Buffer.alloc(Number(segmented.payloadBytes))
	let offset = 0
	for (const segment of segmented.segments) {
		const expectedBytes = Number(segment.bytes)
		const chunk = await readOwnerOnlyFile(join(segmentDirectoryPath, segment.file), 'Carry proof journal segment', CARRY_PROOF_JOURNAL_SEGMENT_BYTES, expectedBytes)
		if (payloadChecksum(chunk).toLowerCase() !== segment.checksum.toLowerCase()) throw new Error(`Carry proof journal segment ${segment.file} checksum does not match its manifest`)
		chunk.copy(payload, offset)
		offset += chunk.byteLength
	}
	if (offset !== payload.byteLength) throw new Error('Carry proof journal segmented payload byte length does not match its manifest')
	if (payloadChecksum(payload).toLowerCase() !== segmented.payloadChecksum.toLowerCase()) throw new Error('Carry proof journal segmented payload checksum does not match its manifest')
	return parseCarryProofJournalEnvelope(payload.toString('utf8'), expected ?? segmented.identity, Number(segmented.residentRecords))
}

function snapshotCarryProofJournalIdentity(identity: CarryProofJournalIdentity): CarryProofJournalIdentity {
	return {
		chainId: identity.chainId,
		initialCursor: { blockHash: identity.initialCursor.blockHash, blockNumber: identity.initialCursor.blockNumber },
		profileId: identity.profileId,
		securityPoolForker: identity.securityPoolForker,
		startBlock: identity.startBlock,
	}
}

function sameCarryProofJournalIdentity(left: CarryProofJournalIdentity | CarryProofJournal, right: CarryProofJournalIdentity | CarryProofJournal) {
	return stableJson(expectedIdentity(left), 'Carry proof journal identity') === stableJson(expectedIdentity(right), 'Replacement carry proof journal identity')
}

async function archiveAuthenticatedCarryProofJournalAndInstallReplacement(path: string, journal: CarryProofJournal, replacement: CarryProofJournal) {
	if (sameCarryProofJournalIdentity(journal, replacement)) throw new Error('Carry proof journal profile reset requires a genuinely different replacement identity')
	const archivedPath = `${path}.profile-reset.${Date.now().toString()}.${randomUUID()}`
	// Copy the authenticated old generation first. The active pointer remains
	// loadable if archive creation fails, and the replacement pointer is then
	// installed by the ordinary atomic temporary-file rename.
	await persistCarryProofJournal(archivedPath, journal, serializeNormalizedCarryProofJournal(journal))
	await persistCarryProofJournal(path, replacement, serializeNormalizedCarryProofJournal(replacement), { allowIdentityReplacement: true })
	return archivedPath
}

export async function loadCarryProofJournal(runtimeStatePath: string, identity: CarryProofJournalIdentity, options: { allowProfileReset?: boolean } = {}) {
	const path = carryProofJournalSidecarPath(runtimeStatePath)
	const identitySnapshot = snapshotCarryProofJournalIdentity(identity)
	const allowProfileReset = options.allowProfileReset === true
	// Validate the replacement completely before the queued mutation can archive
	// or remove an active generation.
	const replacement = allowProfileReset ? createCarryProofJournal(identitySnapshot) : undefined
	return await queueCarryJournalMutation(path, async () => {
		try {
			await lstat(path)
		} catch (error) {
			if (errorCode(error) === 'ENOENT') {
				const pristine = replacement ?? createCarryProofJournal(identitySnapshot)
				await persistCarryProofJournal(path, pristine, serializeNormalizedCarryProofJournal(pristine))
				return pristine
			}
			throw error
		}
		const current = await readCarryProofJournalFile(path, undefined)
		try {
			assertExpectedIdentity(current, expectedIdentity(identitySnapshot))
			return current
		} catch (error) {
			if (!allowProfileReset || replacement === undefined || !(error instanceof CarryProofJournalIdentityMismatchError)) throw error
			// The mismatch decision, full old-generation authentication, archival,
			// and replacement commit share this one serialized mutation boundary.
			await archiveAuthenticatedCarryProofJournalAndInstallReplacement(path, current, replacement)
			return replacement
		}
	})
}

async function assertSidecarIsNotSymlink(path: string) {
	try {
		const metadata = await lstat(path)
		if (metadata.isSymbolicLink()) throw new Error(`Carry proof journal ${path} must not be a symbolic link`)
		if (!metadata.isFile()) throw new Error(`Carry proof journal ${path} must be a regular file`)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return
		throw error
	}
}

const journalWriteQueues = new Map<string, Promise<void>>()

function queueCarryJournalMutation<T>(path: string, mutation: () => Promise<T>) {
	const previous = journalWriteQueues.get(path)
	const result = (previous === undefined ? Promise.resolve() : previous).then(mutation)
	const settled = result.then(
		() => undefined,
		() => undefined,
	)
	const tracked = settled.finally(() => {
		if (journalWriteQueues.get(path) === tracked) journalWriteQueues.delete(path)
	})
	journalWriteQueues.set(path, tracked)
	return result
}

/**
 * Preserves an incompatible derived sidecar during an already-authorized,
 * no-pending-transaction deployment-profile reset. Callers must never use this
 * as recovery from corruption or an unexpected identity mismatch.
 */
export async function archiveCarryProofJournalForProfileReset(runtimeStatePath: string, replacementIdentity: CarryProofJournalIdentity, expectedCurrentRevision: Hash) {
	const path = carryProofJournalSidecarPath(runtimeStatePath)
	const replacementIdentitySnapshot = snapshotCarryProofJournalIdentity(replacementIdentity)
	const replacement = createCarryProofJournal(replacementIdentitySnapshot)
	const revision = hash(expectedCurrentRevision, 'Expected carry proof journal profile-reset revision')
	return await queueCarryJournalMutation(path, async () => {
		try {
			await lstat(path)
		} catch (error) {
			if (errorCode(error) === 'ENOENT') throw new Error('Carry proof journal expected profile-reset revision is missing')
			throw error
		}
		const journal = await readCarryProofJournalFile(path, undefined)
		if (carryProofJournalDigestFromNormalized(journal).toLowerCase() !== revision.toLowerCase()) throw new Error('Carry proof journal changed after the profile reset was authorized')
		return await archiveAuthenticatedCarryProofJournalAndInstallReplacement(path, journal, replacement)
	})
}

async function writeOwnerOnlyFile(path: string, contents: string | Uint8Array) {
	const handle = await open(path, 'wx', 0o600)
	try {
		await handle.writeFile(contents)
		await handle.chmod(0o600)
		await handle.sync()
	} finally {
		await handle.close()
	}
}

async function currentSegmentEnvelope(path: string) {
	try {
		const contents = (await readOwnerOnlyFile(path, 'Carry proof journal', CARRY_PROOF_JOURNAL_SEGMENT_BYTES)).toString('utf8')
		return parseSegmentedEnvelope(contents)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined
		throw error
	}
}

async function verifyPersistedCarryProofJournalGeneration(path: string, expected: CarryProofJournalExpectedIdentity, segmentDirectoryPath: string) {
	const mainPayload = await readOwnerOnlyFile(path, 'Carry proof journal', CARRY_PROOF_JOURNAL_SEGMENT_BYTES)
	const contents = mainPayload.toString('utf8')
	const segmented = parseSegmentedEnvelope(contents)
	if (segmented === undefined) {
		parseCarryProofJournal(contents, expected)
		return
	}
	if (mainPayload.byteLength > CARRY_PROOF_JOURNAL_MANIFEST_BYTES) throw new Error(`Carry proof journal segmented manifest exceeds its ${CARRY_PROOF_JOURNAL_MANIFEST_BYTES.toString()}-byte safety limit`)
	assertExpectedIdentity(segmented.identity, expected)
	if (segmented.segmentDirectory !== basename(segmentDirectoryPath)) throw new Error('Carry proof journal segmented manifest belongs to a different segment directory')
	await assertOwnerOnlyDirectory(segmentDirectoryPath, 'Carry proof journal segment directory')
	let verifiedBytes = 0n
	for (const segment of segmented.segments) {
		const expectedBytes = Number(segment.bytes)
		const chunk = await readOwnerOnlyFile(join(segmentDirectoryPath, segment.file), 'Carry proof journal segment', CARRY_PROOF_JOURNAL_SEGMENT_BYTES, expectedBytes)
		if (payloadChecksum(chunk).toLowerCase() !== segment.checksum.toLowerCase()) throw new Error(`Carry proof journal segment ${segment.file} checksum does not match its manifest`)
		verifiedBytes += BigInt(chunk.byteLength)
	}
	if (verifiedBytes !== BigInt(segmented.payloadBytes)) throw new Error('Carry proof journal persisted segment byte length does not match its manifest')
}

function segmentedPayload(segmentDirectoryPath: string, journal: CarryProofJournal, contents: string, reusable: SegmentedJournalEnvelope | undefined) {
	const payload = Buffer.from(contents, 'utf8')
	if (payload.byteLength > CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES) throw new Error(`Carry proof journal exceeds its ${CARRY_PROOF_JOURNAL_MAXIMUM_PAYLOAD_BYTES.toString()}-byte payload safety limit`)
	if (payload.byteLength <= CARRY_PROOF_JOURNAL_SEGMENT_BYTES) return { mainContents: contents, segments: [] }
	const generation = randomUUID()
	const segments: Array<{ contents: Buffer; created: boolean; descriptor: JournalSegmentDescriptor; path: string }> = []
	for (let offset = 0, index = 0; offset < payload.byteLength; offset += CARRY_PROOF_JOURNAL_SEGMENT_BYTES, index += 1) {
		const chunk = payload.subarray(offset, Math.min(offset + CARRY_PROOF_JOURNAL_SEGMENT_BYTES, payload.byteLength))
		const checksum = payloadChecksum(chunk)
		const previous = reusable?.segments[index]
		const reused = previous !== undefined && previous.bytes === chunk.byteLength.toString() && previous.checksum.toLowerCase() === checksum.toLowerCase()
		const file = reused ? previous.file : `segment.${generation}.${index.toString().padStart(8, '0')}.part`
		segments.push({
			contents: chunk,
			created: !reused,
			descriptor: { bytes: chunk.byteLength.toString(), checksum, file },
			path: join(segmentDirectoryPath, file),
		})
	}
	const manifestPayload: SegmentedJournalManifestPayload = {
		format: SEGMENTED_JOURNAL_ENVELOPE_FORMAT,
		identity: expectedIdentity(journal),
		payloadBytes: payload.byteLength.toString(),
		payloadChecksum: payloadChecksum(payload),
		residentRecords: carryProofJournalResidentRecords(journal).toString(),
		segmentCount: segments.length.toString(),
		segmentDirectory: basename(segmentDirectoryPath),
		segments: segments.map(segment => segment.descriptor),
	}
	const envelope: SegmentedJournalEnvelope = { ...manifestPayload, manifestChecksum: segmentedManifestChecksum(manifestPayload) }
	const mainContents = `${JSON.stringify(envelope, undefined, 2)}\n`
	if (Buffer.byteLength(mainContents, 'utf8') > CARRY_PROOF_JOURNAL_MANIFEST_BYTES) throw new Error('Carry proof journal segmented manifest exceeds its fixed safety limit')
	return { mainContents, segments }
}

async function syncOwnerOnlyDirectory(path: string) {
	const directoryHandle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		await directoryHandle.sync()
	} finally {
		await directoryHandle.close()
	}
}

async function syncParentDirectory(path: string) {
	await syncOwnerOnlyDirectory(dirname(path))
}

interface DeferredCarryJournalMaintenance {
	parentDirectorySyncPending: boolean
	segmentDirectorySyncPending: boolean
	staleSegments: Set<string>
}

const deferredCarryJournalMaintenance = new Map<string, DeferredCarryJournalMaintenance>()

function injectPostCommitFault(point: CarryProofJournalPostCommitFaultPoint) {
	if (carryProofJournalPostCommitFaultForTesting !== point) return
	carryProofJournalPostCommitFaultForTesting = undefined
	throw new Error(`Injected carry proof journal post-commit ${point} failure`)
}

async function completeDeferredCarryJournalMaintenance(path: string, segmentDirectoryPath: string, maintenance: DeferredCarryJournalMaintenance) {
	try {
		if (maintenance.parentDirectorySyncPending) {
			injectPostCommitFault('parent-directory-sync')
			await syncParentDirectory(path)
			maintenance.parentDirectorySyncPending = false
		}
		if (maintenance.segmentDirectorySyncPending) {
			injectPostCommitFault('segment-directory-sync')
			await syncOwnerOnlyDirectory(segmentDirectoryPath)
			maintenance.segmentDirectorySyncPending = false
		}
		if (maintenance.staleSegments.size > 0) {
			injectPostCommitFault('cleanup')
			for (const segment of [...maintenance.staleSegments]) {
				await rm(segment, { force: true })
				maintenance.staleSegments.delete(segment)
			}
			await syncOwnerOnlyDirectory(segmentDirectoryPath)
		}
	} catch (error) {
		const failureType = error instanceof Error && error.name.length > 0 ? error.name : 'UnknownError'
		console.warn(`chaosCarryJournalMaintenance=deferred failureType=${failureType}`)
		deferredCarryJournalMaintenance.set(path, maintenance)
		return !maintenance.parentDirectorySyncPending
	}
	deferredCarryJournalMaintenance.delete(path)
	return true
}

function carryJournalOwnedArtifact(name: string) {
	return CARRY_PROOF_JOURNAL_SEGMENT_FILE_PATTERN.test(name) || CARRY_PROOF_JOURNAL_TEMPORARY_FILE_PATTERN.test(name)
}

async function pruneCarryJournalArtifacts(segmentDirectoryPath: string, retained: ReadonlySet<string>) {
	let directory
	try {
		directory = await opendir(segmentDirectoryPath)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return 0
		throw error
	}
	let visited = 0
	let remaining = 0
	let removed = false
	let incomplete = false
	for await (const entry of directory) {
		if (visited >= CARRY_PROOF_JOURNAL_DIRECTORY_MAXIMUM_ENTRIES) {
			incomplete = true
			break
		}
		visited += 1
		if (carryJournalOwnedArtifact(entry.name) && !retained.has(entry.name)) {
			await rm(join(segmentDirectoryPath, entry.name), { force: true })
			removed = true
			continue
		}
		remaining += 1
	}
	if (removed) await syncOwnerOnlyDirectory(segmentDirectoryPath)
	return incomplete ? undefined : remaining
}

function pristineCarryProofJournal(journal: CarryProofJournal) {
	return !journal.scanStarted && journal.checkpoint === undefined && journal.events.length === 0 && journal.cursor.blockNumber === journal.startBlock
}

function equalCursorReplacementIsAuthorized(existing: CarryProofJournal, replacement: CarryProofJournal) {
	const existingDigest = carryProofJournalDigestFromNormalized(existing)
	if (existingDigest.toLowerCase() === carryProofJournalDigestFromNormalized(replacement).toLowerCase()) return true
	if (pristineCarryProofJournal(existing) && replacement.scanStarted && replacement.checkpoint === undefined && replacement.events.length === 0 && replacement.cursor.blockNumber === existing.cursor.blockNumber && replacement.cursor.blockHash.toLowerCase() === existing.cursor.blockHash.toLowerCase()) {
		return true
	}
	if (existing.events.length === 0) return false
	const compacted = compactNormalizedCarryProofJournal(existing)
	return carryProofJournalDigestFromNormalized(compacted).toLowerCase() === carryProofJournalDigestFromNormalized(replacement).toLowerCase()
}

async function persistCarryProofJournal(path: string, journal: CarryProofJournal, contents: string, options: { allowCanonicalReset?: boolean; allowIdentityReplacement?: boolean; expectedCurrentRevision?: Hash } = {}) {
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	await assertSidecarIsNotSymlink(path)
	const segmentDirectoryPath = carryJournalSegmentDirectoryForSidecar(path)
	const deferredMaintenance = deferredCarryJournalMaintenance.get(path)
	if (deferredMaintenance !== undefined && !(await completeDeferredCarryJournalMaintenance(path, segmentDirectoryPath, deferredMaintenance))) {
		throw new Error('Carry proof journal prior pointer commit could not be made crash-durable')
	}
	let existingJournal: CarryProofJournal | undefined
	let pointerExists = true
	try {
		await lstat(path)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') pointerExists = false
		else throw error
	}
	if (pointerExists) existingJournal = await readCarryProofJournalFile(path, options.allowIdentityReplacement === true ? undefined : expectedIdentity(journal), segmentDirectoryPath)
	if (options.allowCanonicalReset === true && options.expectedCurrentRevision === undefined) {
		throw new Error('Carry proof journal canonical reset requires an expected current journal revision')
	}
	if (options.expectedCurrentRevision !== undefined) {
		if (existingJournal === undefined) {
			throw new Error('Carry proof journal expected current revision is missing')
		}
		if (carryProofJournalDigestFromNormalized(existingJournal).toLowerCase() !== options.expectedCurrentRevision.toLowerCase()) {
			throw new Error('Carry proof journal changed after the replacement was prepared')
		}
	}
	if (options.allowIdentityReplacement !== true && options.allowCanonicalReset !== true && existingJournal !== undefined && BigInt(existingJournal.cursor.blockNumber) > BigInt(journal.cursor.blockNumber)) {
		throw new Error(`Carry proof journal replacement cursor ${journal.cursor.blockNumber} precedes persisted cursor ${existingJournal.cursor.blockNumber}`)
	}
	if (options.allowIdentityReplacement !== true && options.allowCanonicalReset !== true && existingJournal !== undefined && existingJournal.cursor.blockNumber === journal.cursor.blockNumber && existingJournal.cursor.blockHash.toLowerCase() !== journal.cursor.blockHash.toLowerCase()) {
		throw new Error(`Carry proof journal replacement changes canonical hash at persisted cursor ${journal.cursor.blockNumber}; reset authorization is required`)
	}
	if (options.allowIdentityReplacement !== true && options.allowCanonicalReset !== true && existingJournal?.scanStarted === true && !journal.scanStarted) {
		throw new Error('Carry proof journal replacement clears canonical scan progress; reset authorization is required')
	}
	if (options.allowIdentityReplacement !== true && options.allowCanonicalReset !== true && existingJournal !== undefined && existingJournal.cursor.blockNumber === journal.cursor.blockNumber && !equalCursorReplacementIsAuthorized(existingJournal, journal)) {
		throw new Error(`Carry proof journal replacement diverges from persisted cursor ${journal.cursor.blockNumber}`)
	}
	await mkdir(segmentDirectoryPath, { mode: 0o700, recursive: true })
	await assertOwnerOnlyDirectory(segmentDirectoryPath, 'Carry proof journal segment directory')
	await syncParentDirectory(segmentDirectoryPath)
	const oldEnvelope = await currentSegmentEnvelope(path)
	if (oldEnvelope !== undefined) {
		if (options.allowIdentityReplacement !== true) assertExpectedIdentity(oldEnvelope.identity, expectedIdentity(journal))
		if (oldEnvelope.segmentDirectory !== basename(segmentDirectoryPath)) throw new Error('Carry proof journal segmented manifest belongs to a different segment directory')
	}
	const oldSegments = oldEnvelope?.segments.map(segment => join(segmentDirectoryPath, segment.file)) ?? []
	const oldSegmentNames = new Set(oldEnvelope?.segments.map(segment => segment.file) ?? [])
	const remainingEntries = await pruneCarryJournalArtifacts(segmentDirectoryPath, oldSegmentNames)
	if (remainingEntries === undefined) {
		throw new Error(`Carry proof journal cleanup reached its ${CARRY_PROOF_JOURNAL_DIRECTORY_MAXIMUM_ENTRIES.toString()}-entry per-save safety limit; retry to continue bounded cleanup`)
	}
	const persisted = segmentedPayload(segmentDirectoryPath, journal, contents, oldEnvelope)
	const temporaryPath = join(segmentDirectoryPath, `temporary.${process.pid.toString()}.${randomUUID()}.tmp`)
	const createdSegments: string[] = []
	const createdSegmentCount = persisted.segments.filter(segment => segment.created).length
	if (remainingEntries + createdSegmentCount + 1 > CARRY_PROOF_JOURNAL_DIRECTORY_MAXIMUM_ENTRIES) {
		throw new Error(`Carry proof journal save would exceed its ${CARRY_PROOF_JOURNAL_DIRECTORY_MAXIMUM_ENTRIES.toString()}-entry segment-directory safety limit`)
	}
	try {
		for (const segment of persisted.segments) {
			if (!segment.created) continue
			await writeOwnerOnlyFile(segment.path, segment.contents)
			createdSegments.push(segment.path)
		}
		if (createdSegments.length > 0) await syncOwnerOnlyDirectory(segmentDirectoryPath)
		await writeOwnerOnlyFile(temporaryPath, persisted.mainContents)
		// Verify the pointer and each bounded segment independently. Reconstructing,
		// parsing, and replaying a second complete payload here would coexist with
		// the validated journal and serialized generation already held by the save.
		await verifyPersistedCarryProofJournalGeneration(temporaryPath, expectedIdentity(journal), segmentDirectoryPath)
		await assertSidecarIsNotSymlink(path)
		await rename(temporaryPath, path)
	} catch (error) {
		await rm(temporaryPath, { force: true })
		await Promise.all(createdSegments.map(segment => rm(segment, { force: true })))
		throw error
	}
	// `rename` is the visible commit boundary. From here on, rejecting the save
	// would leave the caller holding the previous CAS revision even though readers
	// observe the replacement. Keep both generations crash-safe until the parent
	// directory is durable, and retry every recoverable sync/cleanup on the next
	// serialized mutation instead of reporting a false pre-commit failure.
	const retainedPaths = new Set(persisted.segments.map(segment => segment.path))
	const maintenance: DeferredCarryJournalMaintenance = {
		parentDirectorySyncPending: true,
		segmentDirectorySyncPending: true,
		staleSegments: new Set(oldSegments.filter(segment => !retainedPaths.has(segment))),
	}
	deferredCarryJournalMaintenance.set(path, maintenance)
	await completeDeferredCarryJournalMaintenance(path, segmentDirectoryPath, maintenance)
}

export async function saveCarryProofJournal(runtimeStatePath: string, journal: CarryProofJournal, options: { allowCanonicalReset?: boolean; expectedCurrentRevision?: Hash } = {}) {
	const path = carryProofJournalSidecarPath(runtimeStatePath)
	// Snapshot caller-owned data before queueing. A queued save must not gain
	// reset authority or change payload because its caller mutates an object
	// after invocation.
	const journalSnapshot = structuredClone(journal)
	const allowCanonicalReset = options.allowCanonicalReset === true
	const expectedCurrentRevision = options.expectedCurrentRevision === undefined ? undefined : hash(options.expectedCurrentRevision, 'Expected carry proof journal revision')
	await queueCarryJournalMutation(path, async () => {
		const normalized = validateCarryProofJournal(journalSnapshot)
		const contents = serializeNormalizedCarryProofJournal(normalized)
		await persistCarryProofJournal(path, normalized, contents, {
			allowCanonicalReset,
			...(expectedCurrentRevision === undefined ? {} : { expectedCurrentRevision }),
		})
	})
}
