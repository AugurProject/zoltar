import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { concatHex, getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { canonicalUintString, type CanonicalUintString } from '../core/units.ts'
import {
	appendCarryLeafToAccumulator,
	applyCarryConsumptionToAccumulator,
	carryGameAccounting,
	carryProofAccumulatorAccounting,
	carryProofAccumulatorIsNullified,
	carryProofAccumulatorSnapshotSlots,
	createCarriedDepositProofFromAccumulator,
	createCarryProofAccumulator,
	initializeCarryProofAccumulatorFromCheckpoint,
	materializeCarryProofAccumulatorState,
	parseCarryGameState,
	setCarryProofAccumulatorAccounting,
	validateCarryCheckpoint,
	type CarriedDepositProof,
	type CarryCheckpoint,
	type CarryAccounting,
	type CarryGameState,
	type CarryLeaf,
	type CarryOutcome,
	type CarryProofAccumulator,
	type CarryProofAccumulatorInstrumentation,
	type CarryTriple,
} from './carry-proof-index.ts'

export const CARRY_PROOF_JOURNAL_SCHEMA_VERSION = 2
export const CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD = 8_192
export const CARRY_PROOF_JOURNAL_SEGMENT_BYTES = 1024 * 1024

const UINT_PATTERN = /^(?:0|[1-9]\d*)$/
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const MAXIMUM_UINT256 = (1n << 256n) - 1n
const JOURNAL_ENVELOPE_FORMAT = 'zoltar-chaos-carry-proof-journal-v2'
const SEGMENTED_JOURNAL_ENVELOPE_FORMAT = 'zoltar-chaos-carry-proof-journal-segmented-v2'
const CARRY_EVENT_CHAIN_DOMAIN = 'zoltar-chaos-carry-event-chain-v1'

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

export interface CarryJournalCheckpointGame {
	game: Address
	pool: Address
	state: CarryGameState
	localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
	source: { game: Address; pool: Address; snapshotId: Hash } | null
	haircut: { rebasedElapsed: string; repBeforeAttoRep: CanonicalUintString; repRemovedAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString } | null
	rawAccounting: CarryJournalRawAccounting | null
}

export interface CarryJournalCheckpointSourceSnapshot {
	snapshotId: Hash
	sourceGame: Address
	sourcePool: Address
	state: CarryGameState
}

export interface CarryProofJournalCheckpoint {
	schemaVersion: 1
	cutoff: CarryJournalCursor
	prefixEventCount: string
	prefixEventDigest: Hash
	checkpointSnapshotCount: string
	games: CarryJournalCheckpointGame[]
	pendingSourceSnapshots: CarryJournalCheckpointSourceSnapshot[]
	directlyClaimedDeposits: Array<{ sourceGame: Address; outcome: CarryOutcome; parentDepositIndex: string }>
	forkSnapshotIds: Hash[]
	lastLocalNodeIds: Array<{ game: Address; nodeId: string }>
}

export interface CarryProofJournal {
	schemaVersion: 2
	chainId: number
	profileId: string
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

export interface ReplayedCarryGame {
	game: Address
	pool: Address
	sourceGame?: Address
	snapshotId?: Hash
	state: CarryGameState
	/** Needed to deterministically separate haircut-exempt local REP from inherited REP. */
	localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString>
}

export interface CarryProofReplayInstrumentation extends CarryProofAccumulatorInstrumentation {
	accumulatorCount: number
}

export interface CarryProofReplayResult {
	games: Record<string, ReplayedCarryGame>
	proofCandidates: CarryProofCandidate[]
	directlyClaimedDeposits: Array<{ sourceGame: Address; outcome: CarryOutcome; parentDepositIndex: string }>
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
	payloadBytes: string
	payloadChecksum: Hash
	segments: JournalSegmentDescriptor[]
}

interface ReplayGameInternal {
	accumulator: CarryProofAccumulator
	game: Address
	haircut: { rebasedElapsed: string; repBeforeAttoRep: CanonicalUintString; repRemovedAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString } | null
	localUnresolvedTotalsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString]
	pool: Address
	rawAccounting: CarryJournalRawAccounting | null
	sourceGame?: Address
	snapshotId?: Hash
}

interface ReplayContext {
	forkSourceStateBySnapshotId: Map<string, { sourceGame: Address; sourcePool: Address; state: CarryGameState }>
	checkpointSnapshotCount: number
	journal: CarryProofJournal
}

interface ReplayWorkingSet {
	games: Map<string, ReplayGameInternal>
	directClaims: Map<string, { sourceGame: Address; outcome: CarryOutcome; parentDepositIndex: string }>
	consumptionByClaimIdentity: Map<string, CarryDepositConsumedJournalEvent>
	drainByTransactionAndPool: Map<string, DisputeStakedRepDrainedJournalEvent>
	forkSnapshotIds: Set<string>
	claimIdentities: Set<string>
	localNodeIdentities: Set<string>
	lastLocalNodeIdByGame: Map<string, bigint>
}

function uintString(value: string, label: string) {
	if (!UINT_PATTERN.test(value)) throw new Error(`${label} must be a canonical unsigned decimal integer`)
	const parsed = BigInt(value)
	if (parsed > MAXIMUM_UINT256) throw new Error(`${label} exceeds uint256`)
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
	exactKeys(record, ['game', 'haircut', 'localUnresolvedTotalsAttoRep', 'pool', 'rawAccounting', 'source', 'state'], label)
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
	const game = address(stringField(record, 'game', label), `${label}.game`)
	const localUnresolvedTotalsAttoRep = parseUintTriple(record['localUnresolvedTotalsAttoRep'], `${label}.localUnresolvedTotalsAttoRep`)
	const state = parseCarryGameState(record['state'], `${label}.state`)
	const localSlotTotals = checkpointLocalSlotTotals(game, state, `${label}.state`)
	for (const outcome of [0, 1, 2] as const) {
		if (localSlotTotals[outcome] !== localUnresolvedTotalsAttoRep[outcome]) throw new Error(`${label}.localUnresolvedTotalsAttoRep does not match outcome ${outcome.toString()} local slots`)
	}
	return {
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
	exactKeys(record, ['snapshotId', 'sourceGame', 'sourcePool', 'state'], label)
	const sourceGame = address(stringField(record, 'sourceGame', label), `${label}.sourceGame`)
	const state = parseCarryGameState(record['state'], `${label}.state`)
	checkpointLocalSlotTotals(sourceGame, state, `${label}.state`)
	return {
		snapshotId: hash(stringField(record, 'snapshotId', label), `${label}.snapshotId`),
		sourceGame,
		sourcePool: address(stringField(record, 'sourcePool', label), `${label}.sourcePool`),
		state,
	}
}

function parseCheckpoint(value: unknown): CarryProofJournalCheckpoint {
	const label = 'carry proof journal checkpoint'
	const record = requiredRecord(value, label)
	exactKeys(record, ['checkpointSnapshotCount', 'cutoff', 'directlyClaimedDeposits', 'forkSnapshotIds', 'games', 'lastLocalNodeIds', 'pendingSourceSnapshots', 'prefixEventCount', 'prefixEventDigest', 'schemaVersion'], label)
	if (record['schemaVersion'] !== 1) throw new Error(`${label}.schemaVersion is unsupported`)
	const cutoffRecord = requiredRecord(record['cutoff'], `${label}.cutoff`)
	exactKeys(cutoffRecord, ['blockHash', 'blockNumber'], `${label}.cutoff`)
	const cutoff: CarryJournalCursor = {
		blockHash: hash(stringField(cutoffRecord, 'blockHash', `${label}.cutoff`), `${label}.cutoff.blockHash`),
		blockNumber: stringField(cutoffRecord, 'blockNumber', `${label}.cutoff`),
	}
	uintString(cutoff.blockNumber, `${label}.cutoff.blockNumber`)
	const prefixEventCount = stringField(record, 'prefixEventCount', label)
	positiveUint(prefixEventCount, `${label}.prefixEventCount`)
	const checkpointSnapshotCount = stringField(record, 'checkpointSnapshotCount', label)
	uintString(checkpointSnapshotCount, `${label}.checkpointSnapshotCount`)
	const gamesValue = record['games']
	const snapshotsValue = record['pendingSourceSnapshots']
	const directClaimsValue = record['directlyClaimedDeposits']
	const forkSnapshotIdsValue = record['forkSnapshotIds']
	const lastLocalNodeIdsValue = record['lastLocalNodeIds']
	if (!Array.isArray(gamesValue)) throw new Error(`${label}.games must be an array`)
	if (!Array.isArray(snapshotsValue)) throw new Error(`${label}.pendingSourceSnapshots must be an array`)
	if (!Array.isArray(directClaimsValue)) throw new Error(`${label}.directlyClaimedDeposits must be an array`)
	if (!Array.isArray(forkSnapshotIdsValue)) throw new Error(`${label}.forkSnapshotIds must be an array`)
	if (!Array.isArray(lastLocalNodeIdsValue)) throw new Error(`${label}.lastLocalNodeIds must be an array`)
	const games = gamesValue.map(parseCheckpointGame)
	const pendingSourceSnapshots = snapshotsValue.map(parseCheckpointSourceSnapshot)
	const directlyClaimedDeposits = directClaimsValue.map((entry, index) => {
		const entryLabel = `${label}.directlyClaimedDeposits[${index.toString()}]`
		const entryRecord = requiredRecord(entry, entryLabel)
		exactKeys(entryRecord, ['outcome', 'parentDepositIndex', 'sourceGame'], entryLabel)
		const parentDepositIndex = stringField(entryRecord, 'parentDepositIndex', entryLabel)
		uintString(parentDepositIndex, `${entryLabel}.parentDepositIndex`)
		return {
			outcome: parseOutcome(entryRecord['outcome'], `${entryLabel}.outcome`),
			parentDepositIndex,
			sourceGame: address(stringField(entryRecord, 'sourceGame', entryLabel), `${entryLabel}.sourceGame`),
		}
	})
	const forkSnapshotIds = forkSnapshotIdsValue.map((value, index) => {
		if (typeof value !== 'string') throw new Error(`${label}.forkSnapshotIds[${index.toString()}] must be a string`)
		return hash(value, `${label}.forkSnapshotIds[${index.toString()}]`)
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
	const directClaimIdentities = directlyClaimedDeposits.map(claim => directClaimIdentity(claim.sourceGame, claim.outcome, claim.parentDepositIndex))
	const forkIdentities = forkSnapshotIds.map(snapshotId => snapshotId.toLowerCase())
	const lastNodeIdentities = lastLocalNodeIds.map(entry => entry.game.toLowerCase())
	unique(gameIdentities, 'games')
	unique(snapshotIdentities, 'pending source snapshots')
	unique(directClaimIdentities, 'direct claims')
	unique(forkIdentities, 'fork snapshot ids')
	unique(lastNodeIdentities, 'last-local-node games')
	canonical(gameIdentities, 'games')
	canonical(snapshotIdentities, 'pending source snapshots')
	canonical(directClaimIdentities, 'direct claims')
	canonical(forkIdentities, 'fork snapshot ids')
	canonical(lastNodeIdentities, 'last-local-node games')
	if (BigInt(checkpointSnapshotCount) !== BigInt(forkSnapshotIds.length)) throw new Error(`${label}.checkpointSnapshotCount does not match its fork snapshot identities`)
	const forkIds = new Set(forkSnapshotIds.map(value => value.toLowerCase()))
	if (pendingSourceSnapshots.some(snapshot => !forkIds.has(snapshot.snapshotId.toLowerCase()))) throw new Error(`${label} pending source snapshot lacks its fork uniqueness fact`)
	if (forkIds.size !== pendingSourceSnapshots.length) throw new Error(`${label} fork uniqueness facts do not exactly match pending source snapshots`)
	const sourceSnapshotById = new Map(pendingSourceSnapshots.map(snapshot => [snapshot.snapshotId.toLowerCase(), snapshot]))
	for (const game of games) {
		if (game.source === null) continue
		const snapshot = sourceSnapshotById.get(game.source.snapshotId.toLowerCase())
		if (snapshot === undefined || snapshot.sourceGame.toLowerCase() !== game.source.game.toLowerCase() || snapshot.sourcePool.toLowerCase() !== game.source.pool.toLowerCase()) {
			throw new Error(`${label} inherited game ${game.game} lacks its exact source snapshot`)
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
	if (directlyClaimedDeposits.some(claim => !knownGames.has(claim.sourceGame.toLowerCase()))) throw new Error(`${label} has a direct claim for an unknown source game`)
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
		cutoff,
		directlyClaimedDeposits,
		forkSnapshotIds,
		games,
		lastLocalNodeIds,
		pendingSourceSnapshots,
		prefixEventCount,
		prefixEventDigest: hash(stringField(record, 'prefixEventDigest', label), `${label}.prefixEventDigest`),
		schemaVersion: 1,
	}
}

function normalizeJournal(journal: CarryProofJournal): CarryProofJournal {
	if (journal.schemaVersion !== CARRY_PROOF_JOURNAL_SCHEMA_VERSION) throw new Error('Carry proof journal schema version is unsupported')
	if (!Number.isSafeInteger(journal.chainId) || journal.chainId < 1) throw new Error('Carry proof journal chainId must be a positive safe integer')
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
	const checkpoint = journal.checkpoint === undefined ? undefined : parseCheckpoint(journal.checkpoint)
	if (checkpoint !== undefined) {
		if (BigInt(checkpoint.cutoff.blockNumber) < BigInt(startBlock)) throw new Error('Carry proof journal checkpoint cutoff precedes startBlock')
		if (BigInt(checkpoint.cutoff.blockNumber) > BigInt(cursor.blockNumber)) throw new Error('Carry proof journal checkpoint cutoff follows the canonical cursor')
		if (checkpoint.cutoff.blockNumber === cursor.blockNumber && checkpoint.cutoff.blockHash.toLowerCase() !== cursor.blockHash.toLowerCase()) {
			throw new Error('Carry proof journal checkpoint cutoff disagrees with the canonical cursor hash')
		}
	}
	const events = journal.events.map((event, index) => parseCarryProofJournalEvent(event, index))
	const identities = new Set<string>()
	const logIdentityByBlock = new Set<string>()
	const blockHashByNumber = new Map<string, string>()
	const transactionPositionByHash = new Map<string, string>()
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
		transactionPositionByHash.set(transactionIdentity, transactionPosition)
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

export function appendCarryProofJournalEvents(journal: CarryProofJournal, additions: readonly CarryProofJournalEvent[], cursor: CarryJournalCursor): CarryProofJournal {
	const current = normalizeJournal(journal)
	uintString(cursor.blockNumber, 'Next carry cursor blockNumber')
	hash(cursor.blockHash, 'Next carry cursor blockHash')
	if (BigInt(cursor.blockNumber) < BigInt(current.cursor.blockNumber)) throw new Error('Next carry cursor cannot move backwards')
	if (cursor.blockNumber === current.cursor.blockNumber && cursor.blockHash.toLowerCase() !== current.cursor.blockHash.toLowerCase()) {
		throw new Error('Next carry cursor changes the current canonical hash; reset is required')
	}
	for (const [index, addition] of additions.entries()) {
		if (BigInt(addition.position.blockNumber) < BigInt(current.cursor.blockNumber)) throw new Error(`Added carry event ${index.toString()} precedes the persisted cursor`)
	}
	return normalizeJournal({
		...current,
		cursor: { ...cursor },
		events: [...current.events, ...additions],
	})
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

function createReplayGame(game: Address, pool: Address): ReplayGameInternal {
	return {
		accumulator: createCarryProofAccumulator(game, pool),
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
	const created = createReplayGame(game, pool)
	working.games.set(key, created)
	return created
}

function claimIdentity(event: Pick<ClaimDepositJournalEvent | CarryDepositConsumedJournalEvent, 'emitter' | 'outcome' | 'parentDepositIndex' | 'position'>) {
	return `${event.position.transactionHash.toLowerCase()}:${event.emitter.toLowerCase()}:${event.outcome.toString()}:${event.parentDepositIndex}`
}

function directClaimIdentity(sourceGame: Address, outcome: CarryOutcome, parentDepositIndex: string) {
	return `${sourceGame.toLowerCase()}:${outcome.toString()}:${parentDepositIndex}`
}

function carryOutcome(value: number): CarryOutcome {
	if (value === 0 || value === 1 || value === 2) return value
	throw new Error(`Carry outcome ${value.toString()} is outside the commitment triple`)
}

function carryTriple<T>(first: T, second: T, third: T): CarryTriple<T> {
	return [first, second, third]
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
	appendCarryLeafToAccumulator(game.accumulator, leaf)
	game.localUnresolvedTotalsAttoRep[event.outcome] = (BigInt(game.localUnresolvedTotalsAttoRep[event.outcome]) + BigInt(event.amountAttoRep)).toString()
}

function processCarryConsumption(event: CarryDepositConsumedJournalEvent, working: ReplayWorkingSet) {
	const game = ensureReplayGame(working, event.emitter, event.pool)
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
	if (kind === 'local') {
		if (BigInt(event.amountAttoRep) > previousLocal) throw new Error('Carry local consumption exceeds replayed local unresolved accounting')
		game.localUnresolvedTotalsAttoRep[event.outcome] = (previousLocal - BigInt(event.amountAttoRep)).toString()
	} else {
		const resultingTotal = BigInt(event.resultingUnresolvedTotalAttoRep)
		if (resultingTotal < previousLocal) throw new Error('Carry inherited consumption reduced unresolved accounting below replayed local REP')
	}
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
		const directIdentity = directClaimIdentity(event.emitter, event.outcome, event.parentDepositIndex)
		if (working.directClaims.has(directIdentity)) throw new Error(`Direct parent claim ${directIdentity} is duplicated`)
		working.directClaims.set(directIdentity, { outcome: event.outcome, parentDepositIndex: event.parentDepositIndex, sourceGame: event.emitter })
	}
}

function processHaircut(event: TruthAuctionHaircutJournalEvent, working: ReplayWorkingSet) {
	const game = ensureReplayGame(working, event.emitter, event.pool)
	if (game.haircut !== null) throw new Error(`Carry game ${game.game} contains more than one truth-auction haircut`)
	const expected = deriveTruthAuctionHaircutAccounting(carryProofAccumulatorAccounting(game.accumulator), game.localUnresolvedTotalsAttoRep, event.repBeforeAttoRep, event.repRemainingAttoRep)
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
	game.haircut = {
		rebasedElapsed: event.rebasedElapsed,
		repBeforeAttoRep: event.repBeforeAttoRep,
		repRemainingAttoRep: event.repRemainingAttoRep,
		repRemovedAttoRep: event.repRemovedAttoRep,
	}
}

function processForkDrain(event: DisputeStakedRepDrainedJournalEvent, journal: CarryProofJournal, working: ReplayWorkingSet) {
	if (event.emitter.toLowerCase() !== journal.securityPoolForker.toLowerCase()) throw new Error('DisputeStakedRepDrainedAtFork emitter is not the journal SecurityPoolForker')
	const key = transactionPoolIdentity(event)
	if (working.drainByTransactionAndPool.has(key)) throw new Error(`Fork drain ${key} is duplicated`)
	working.drainByTransactionAndPool.set(key, event)
}

function processForkSnapshot(event: SecurityPoolForkSnapshotJournalEvent, context: ReplayContext, working: ReplayWorkingSet) {
	if (event.emitter.toLowerCase() !== context.journal.securityPoolForker.toLowerCase()) throw new Error('SecurityPoolForkSnapshot emitter is not the journal SecurityPoolForker')
	const snapshotKey = event.escalationSnapshotId.toLowerCase()
	if (!event.unresolvedEscalation) {
		if (event.escalationSnapshotId !== zeroHash) throw new Error('Resolved SecurityPoolForkSnapshot has a nonzero escalation snapshot id')
		return
	}
	if (event.escalationSnapshotId === zeroHash) throw new Error('Unresolved SecurityPoolForkSnapshot has a zero escalation snapshot id')
	if (working.forkSnapshotIds.has(snapshotKey)) throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} is duplicated`)
	const drain = working.drainByTransactionAndPool.get(transactionPoolIdentity(event))
	if (drain === undefined) throw new Error(`SecurityPoolForkSnapshot ${event.escalationSnapshotId} has no preceding same-transaction dispute drain`)
	const source = ensureReplayGame(working, drain.sourceGame, event.pool)
	working.forkSnapshotIds.add(snapshotKey)
	context.forkSourceStateBySnapshotId.set(snapshotKey, {
		sourceGame: source.game,
		sourcePool: source.pool,
		state: materializeCarryProofAccumulatorState(source.accumulator),
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
	const gameKey = event.emitter.toLowerCase()
	if (working.games.has(gameKey)) throw new Error(`ForkCarryCheckpoint target game ${event.emitter} was already initialized`)
	let accumulator: CarryProofAccumulator
	try {
		accumulator = initializeCarryProofAccumulatorFromCheckpoint(event.emitter, event.pool, checkpoint, {
			game: sourceSnapshot.sourceGame,
			state: sourceSnapshot.state,
		})
	} catch (error) {
		if (error instanceof Error) throw new Error(`ForkCarryCheckpoint ${event.snapshotId} does not match the source state captured at its canonical fork marker: ${error.message}`)
		throw error
	}
	working.games.set(gameKey, {
		accumulator,
		game: event.emitter,
		haircut: null,
		localUnresolvedTotalsAttoRep: ['0', '0', '0'],
		pool: event.pool,
		rawAccounting: null,
		snapshotId: event.snapshotId,
		sourceGame: event.sourceGame,
	})
}

function emptyWorkingSet(): ReplayWorkingSet {
	return {
		claimIdentities: new Set(),
		consumptionByClaimIdentity: new Map(),
		directClaims: new Map(),
		drainByTransactionAndPool: new Map(),
		forkSnapshotIds: new Set(),
		games: new Map(),
		lastLocalNodeIdByGame: new Map(),
		localNodeIdentities: new Set(),
	}
}

function initializeReplayFromCheckpoint(checkpoint: CarryProofJournalCheckpoint | undefined, context: ReplayContext, working: ReplayWorkingSet) {
	if (checkpoint === undefined) return
	context.checkpointSnapshotCount = Number(checkpoint.checkpointSnapshotCount)
	for (const game of checkpoint.games) {
		const accumulator = createCarryProofAccumulator(game.game, game.pool, game.state)
		working.games.set(game.game.toLowerCase(), {
			accumulator,
			game: game.game,
			haircut: game.haircut,
			localUnresolvedTotalsAttoRep: [game.localUnresolvedTotalsAttoRep[0], game.localUnresolvedTotalsAttoRep[1], game.localUnresolvedTotalsAttoRep[2]],
			pool: game.pool,
			rawAccounting: game.rawAccounting,
			...(game.source === null ? {} : { snapshotId: game.source.snapshotId, sourceGame: game.source.game }),
		})
	}
	for (const claim of checkpoint.directlyClaimedDeposits) working.directClaims.set(directClaimIdentity(claim.sourceGame, claim.outcome, claim.parentDepositIndex), { ...claim })
	for (const snapshotId of checkpoint.forkSnapshotIds) working.forkSnapshotIds.add(snapshotId.toLowerCase())
	for (const snapshot of checkpoint.pendingSourceSnapshots) {
		context.forkSourceStateBySnapshotId.set(snapshot.snapshotId.toLowerCase(), {
			sourceGame: snapshot.sourceGame,
			sourcePool: snapshot.sourcePool,
			state: snapshot.state,
		})
	}
	for (const entry of checkpoint.lastLocalNodeIds) working.lastLocalNodeIdByGame.set(entry.game.toLowerCase(), BigInt(entry.nodeId))
}

function replayJournalWorkingSet(journal: CarryProofJournal) {
	const context: ReplayContext = {
		checkpointSnapshotCount: 0,
		forkSourceStateBySnapshotId: new Map(),
		journal,
	}
	const working = emptyWorkingSet()
	initializeReplayFromCheckpoint(journal.checkpoint, context, working)
	for (const event of journal.events) {
		if (event.kind === 'local-deposit-appended') processLocalDeposit(event, working)
		else if (event.kind === 'carry-deposit-consumed') processCarryConsumption(event, working)
		else if (event.kind === 'claim-deposit') processClaim(event, working)
		else if (event.kind === 'truth-auction-haircut') processHaircut(event, working)
		else if (event.kind === 'dispute-staked-rep-drained-at-fork') processForkDrain(event, journal, working)
		else if (event.kind === 'security-pool-fork-snapshot') processForkSnapshot(event, context, working)
		else processCheckpoint(event, context, working)
	}
	for (const [identity, consumption] of working.consumptionByClaimIdentity) {
		if ((consumption.reason === 0 || consumption.reason === 3) && !working.claimIdentities.has(identity)) {
			throw new Error(`Carry consumption ${identity} reason ${consumption.reason.toString()} is missing its same-transaction ClaimDeposit`)
		}
	}
	return { context, working }
}

function replayNormalizedJournal(journal: CarryProofJournal, wallet: Address | undefined, output: 'full' | 'states' | 'validate'): CarryProofReplayResult {
	const { context, working } = replayJournalWorkingSet(journal)
	const normalizedWallet = wallet === undefined ? undefined : getAddress(wallet)
	const games: Record<string, ReplayedCarryGame> = {}
	const proofCandidates: CarryProofCandidate[] = []
	for (const game of working.games.values()) {
		if (output === 'full' && game.sourceGame !== undefined && game.snapshotId !== undefined) {
			for (const outcome of [0, 1, 2] as const) {
				for (const slot of carryProofAccumulatorSnapshotSlots(game.accumulator, outcome)) {
					if (slot.hash === zeroHash || slot.consumedLocally) continue
					if (normalizedWallet !== undefined && slot.leaf.depositor.toLowerCase() !== normalizedWallet.toLowerCase()) continue
					if (carryProofAccumulatorIsNullified(game.accumulator, outcome, slot.leaf.parentDepositIndex)) continue
					if (working.directClaims.has(directClaimIdentity(game.sourceGame, outcome, slot.leaf.parentDepositIndex))) continue
					const proof = createCarriedDepositProofFromAccumulator(game.accumulator, outcome, slot.leaf.parentDepositIndex, slot.leaf.sourceNodeId)
					proofCandidates.push({
						amountAttoRep: slot.leaf.amountAttoRep,
						depositor: slot.leaf.depositor,
						game: game.game,
						outcome,
						parentDepositIndex: slot.leaf.parentDepositIndex,
						pool: game.pool,
						proof,
						snapshotId: game.snapshotId,
						sourceGame: game.sourceGame,
						sourceNodeId: slot.leaf.sourceNodeId,
					})
				}
			}
		}
		if (output !== 'validate') {
			const state = materializeCarryProofAccumulatorState(game.accumulator)
			const localUnresolvedTotalsAttoRep: CarryTriple<CanonicalUintString> = [game.localUnresolvedTotalsAttoRep[0], game.localUnresolvedTotalsAttoRep[1], game.localUnresolvedTotalsAttoRep[2]]
			const common = {
				game: game.game,
				localUnresolvedTotalsAttoRep,
				pool: game.pool,
				state,
			}
			games[game.game.toLowerCase()] = game.sourceGame === undefined || game.snapshotId === undefined ? common : { ...common, snapshotId: game.snapshotId, sourceGame: game.sourceGame }
		}
	}
	proofCandidates.sort((left, right) => {
		const gameOrder = left.game.toLowerCase().localeCompare(right.game.toLowerCase())
		if (gameOrder !== 0) return gameOrder
		if (left.outcome !== right.outcome) return left.outcome - right.outcome
		const leftParent = BigInt(left.parentDepositIndex)
		const rightParent = BigInt(right.parentDepositIndex)
		if (leftParent < rightParent) return -1
		if (leftParent > rightParent) return 1
		return 0
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
	return {
		checkpointSnapshotCount: context.checkpointSnapshotCount,
		directlyClaimedDeposits: [...working.directClaims.values()].sort((left, right) => directClaimIdentity(left.sourceGame, left.outcome, left.parentDepositIndex).localeCompare(directClaimIdentity(right.sourceGame, right.outcome, right.parentDepositIndex))),
		games,
		instrumentation,
		proofCandidates,
	}
}

export function replayCarryProofJournal(journal: CarryProofJournal, wallet?: Address) {
	return replayNormalizedJournal(normalizeJournal(journal), wallet, 'full')
}

export function deriveTruthAuctionHaircutJournalEventAccounting(journal: CarryProofJournal, parameters: { game: Address; pool: Address; repBeforeAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString }) {
	const gameAddress = getAddress(parameters.game)
	const poolAddress = getAddress(parameters.pool)
	const replayed = replayNormalizedJournal(normalizeJournal(journal), undefined, 'states').games[gameAddress.toLowerCase()]
	if (replayed !== undefined && replayed.pool.toLowerCase() !== poolAddress.toLowerCase()) {
		throw new Error(`Carry game ${gameAddress} was associated with a different pool before its truth-auction haircut`)
	}
	if (replayed === undefined) {
		return deriveTruthAuctionHaircutAccounting(carryProofAccumulatorAccounting(createCarryProofAccumulator(gameAddress, poolAddress)), ['0', '0', '0'], parameters.repBeforeAttoRep, parameters.repRemainingAttoRep)
	}
	return deriveTruthAuctionHaircutAccounting(carryGameAccounting(replayed.state), replayed.localUnresolvedTotalsAttoRep, parameters.repBeforeAttoRep, parameters.repRemainingAttoRep)
}

export function validateCarryProofJournal(journal: CarryProofJournal) {
	const normalized = normalizeJournal(journal)
	replayNormalizedJournal(normalized, undefined, 'validate')
	return normalized
}

function eventChainGenesis(journal: Pick<CarryProofJournal, 'chainId' | 'profileId' | 'schemaVersion' | 'securityPoolForker' | 'startBlock'>) {
	return keccak256(
		toHex(
			stableJson(
				{
					chainId: journal.chainId,
					domain: CARRY_EVENT_CHAIN_DOMAIN,
					profileId: journal.profileId,
					schemaVersion: journal.schemaVersion,
					securityPoolForker: journal.securityPoolForker,
					startBlock: journal.startBlock,
				},
				'Carry event-chain genesis',
			),
		),
	)
}

function advanceEventChain(digest: Hash, event: CarryProofJournalEvent) {
	return keccak256(concatHex([digest, keccak256(toHex(stableJson(event, 'Carry event-chain event')))]))
}

export function shouldCompactCarryProofJournal(journal: CarryProofJournal) {
	return journal.events.length >= CARRY_PROOF_JOURNAL_COMPACTION_EVENT_THRESHOLD
}

function normalizedRawAccounting(value: CarryJournalRawAccounting | undefined, label: string) {
	if (value === undefined) throw new Error(`${label} is required before carry-journal compaction`)
	const normalized = parseCheckpointRawAccounting(value, label)
	if (normalized === null) throw new Error(`${label} cannot be null`)
	return normalized
}

/**
 * Replaces every validated event through the current finalized cursor with an
 * authenticated replay checkpoint. Events observed after this cutover remain
 * as the naturally short suffix until the next threshold is reached.
 */
export function compactCarryProofJournal(journal: CarryProofJournal, rawAccountingByGame: Readonly<Record<string, CarryJournalRawAccounting>>): CarryProofJournal {
	const normalized = validateCarryProofJournal(journal)
	if (normalized.events.length === 0) return normalized
	const { context, working } = replayJournalWorkingSet(normalized)
	let prefixEventDigest = normalized.checkpoint?.prefixEventDigest ?? eventChainGenesis(normalized)
	for (const event of normalized.events) prefixEventDigest = advanceEventChain(prefixEventDigest, event)
	const games = [...working.games.values()]
		.map(game => {
			const sourceSnapshot = game.snapshotId === undefined ? undefined : context.forkSourceStateBySnapshotId.get(game.snapshotId.toLowerCase())
			if ((game.sourceGame === undefined || game.snapshotId === undefined) !== (sourceSnapshot === undefined)) throw new Error(`Carry game ${game.game} has incomplete compacted source metadata`)
			const source = game.sourceGame === undefined || game.snapshotId === undefined || sourceSnapshot === undefined ? null : { game: game.sourceGame, pool: sourceSnapshot.sourcePool, snapshotId: game.snapshotId }
			return {
				game: game.game,
				haircut: game.haircut,
				localUnresolvedTotalsAttoRep: carryTriple(game.localUnresolvedTotalsAttoRep[0], game.localUnresolvedTotalsAttoRep[1], game.localUnresolvedTotalsAttoRep[2]),
				pool: game.pool,
				rawAccounting: source === null ? null : normalizedRawAccounting(rawAccountingByGame[game.game.toLowerCase()], `Raw carry accounting for ${game.game}`),
				source,
				state: materializeCarryProofAccumulatorState(game.accumulator),
			}
		})
		.sort((left, right) => left.game.toLowerCase().localeCompare(right.game.toLowerCase()))
	const pendingSourceSnapshots = [...context.forkSourceStateBySnapshotId.entries()]
		.map(([snapshotId, snapshot]) => ({
			snapshotId: hash(snapshotId, 'Compacted carry source snapshot id'),
			sourceGame: snapshot.sourceGame,
			sourcePool: snapshot.sourcePool,
			state: snapshot.state,
		}))
		.sort((left, right) => left.snapshotId.toLowerCase().localeCompare(right.snapshotId.toLowerCase()))
	const directlyClaimedDeposits = [...working.directClaims.values()].sort((left, right) => directClaimIdentity(left.sourceGame, left.outcome, left.parentDepositIndex).localeCompare(directClaimIdentity(right.sourceGame, right.outcome, right.parentDepositIndex)))
	const forkSnapshotIds = [...working.forkSnapshotIds].map(snapshotId => hash(snapshotId, 'Compacted fork snapshot id')).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
	const lastLocalNodeIds = [...working.lastLocalNodeIdByGame.entries()].map(([game, nodeId]) => ({ game: address(game, 'Compacted carry game'), nodeId: nodeId.toString() })).sort((left, right) => left.game.toLowerCase().localeCompare(right.game.toLowerCase()))
	const checkpoint: CarryProofJournalCheckpoint = {
		checkpointSnapshotCount: BigInt(context.checkpointSnapshotCount).toString(),
		cutoff: { ...normalized.cursor },
		directlyClaimedDeposits,
		forkSnapshotIds,
		games,
		lastLocalNodeIds,
		pendingSourceSnapshots,
		prefixEventCount: ((normalized.checkpoint === undefined ? 0n : BigInt(normalized.checkpoint.prefixEventCount)) + BigInt(normalized.events.length)).toString(),
		prefixEventDigest,
		schemaVersion: 1,
	}
	return validateCarryProofJournal({ ...normalized, checkpoint, events: [] })
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
export function carryProofJournalDigest(journal: CarryProofJournal) {
	const normalized = normalizeJournal(journal)
	replayNormalizedJournal(normalized, undefined, 'validate')
	let eventHistoryDigest = normalized.checkpoint?.prefixEventDigest ?? eventChainGenesis(normalized)
	for (const event of normalized.events) eventHistoryDigest = advanceEventChain(eventHistoryDigest, event)
	return keccak256(
		toHex(
			stableJson(
				{
					chainId: normalized.chainId,
					checkpointDigest: normalized.checkpoint === undefined ? zeroHash : keccak256(toHex(stableJson(normalized.checkpoint, 'Carry proof journal checkpoint digest'))),
					cursor: normalized.cursor,
					domain: JOURNAL_ENVELOPE_FORMAT,
					eventCount: ((normalized.checkpoint === undefined ? 0n : BigInt(normalized.checkpoint.prefixEventCount)) + BigInt(normalized.events.length)).toString(),
					eventHistoryDigest,
					profileId: normalized.profileId,
					schemaVersion: normalized.schemaVersion,
					securityPoolForker: normalized.securityPoolForker,
					startBlock: normalized.startBlock,
				},
				'Carry proof journal digest header',
			),
		),
	)
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

function assertExpectedIdentity(journal: CarryProofJournal, expected: CarryProofJournalExpectedIdentity) {
	if (journal.chainId !== expected.chainId) throw new CarryProofJournalIdentityMismatchError(`Carry proof journal belongs to chain ${journal.chainId.toString()}, expected ${expected.chainId.toString()}`)
	if (journal.profileId !== expected.profileId) throw new CarryProofJournalIdentityMismatchError('Carry proof journal belongs to a different deployment profile')
	if (journal.securityPoolForker.toLowerCase() !== expected.securityPoolForker.toLowerCase()) throw new CarryProofJournalIdentityMismatchError('Carry proof journal belongs to a different SecurityPoolForker')
	if (journal.startBlock !== expected.startBlock) throw new CarryProofJournalIdentityMismatchError('Carry proof journal has a different immutable start block')
}

function parseJournalPayload(value: unknown): CarryProofJournal {
	const journal = requiredRecord(value, 'carry proof journal')
	const hasCheckpoint = Object.hasOwn(journal, 'checkpoint')
	exactKeys(journal, hasCheckpoint ? ['chainId', 'checkpoint', 'cursor', 'events', 'profileId', 'schemaVersion', 'securityPoolForker', 'startBlock'] : ['chainId', 'cursor', 'events', 'profileId', 'schemaVersion', 'securityPoolForker', 'startBlock'], 'carry proof journal')
	if (journal['schemaVersion'] !== CARRY_PROOF_JOURNAL_SCHEMA_VERSION) throw new Error('Carry proof journal schema version is unsupported')
	if (typeof journal['chainId'] !== 'number') throw new Error('carry proof journal.chainId must be a number')
	const cursorRecord = requiredRecord(journal['cursor'], 'carry proof journal.cursor')
	exactKeys(cursorRecord, ['blockHash', 'blockNumber'], 'carry proof journal.cursor')
	if (!Array.isArray(journal['events'])) throw new Error('carry proof journal.events must be an array')
	return normalizeJournal({
		chainId: journal['chainId'],
		...(hasCheckpoint ? { checkpoint: parseCheckpoint(journal['checkpoint']) } : {}),
		cursor: {
			blockHash: hash(stringField(cursorRecord, 'blockHash', 'carry proof journal.cursor'), 'carry proof journal.cursor.blockHash'),
			blockNumber: stringField(cursorRecord, 'blockNumber', 'carry proof journal.cursor'),
		},
		events: journal['events'].map((event, index) => parseCarryProofJournalEvent(event, index)),
		profileId: profileId(journal['profileId'], 'carry proof journal.profileId'),
		schemaVersion: CARRY_PROOF_JOURNAL_SCHEMA_VERSION,
		securityPoolForker: address(stringField(journal, 'securityPoolForker', 'carry proof journal'), 'carry proof journal.securityPoolForker'),
		startBlock: stringField(journal, 'startBlock', 'carry proof journal'),
	})
}

export function parseCarryProofJournal(contents: string, expected?: CarryProofJournalExpectedIdentity): CarryProofJournal {
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
	const journal = parseJournalPayload(envelope['journal'])
	const computedChecksum = journalChecksum(journal)
	if (checksum.toLowerCase() !== computedChecksum.toLowerCase()) throw new Error('Carry proof journal checksum does not match its payload')
	if (expected !== undefined) assertExpectedIdentity(journal, expected)
	replayNormalizedJournal(journal, undefined, 'validate')
	return journal
}

export function serializedCarryProofJournal(journal: CarryProofJournal) {
	const normalized = validateCarryProofJournal(journal)
	const envelope: JournalEnvelope = {
		checksum: journalChecksum(normalized),
		format: JOURNAL_ENVELOPE_FORMAT,
		journal: normalized,
	}
	return `${JSON.stringify(envelope, undefined, 2)}\n`
}

export function carryProofJournalSidecarPath(runtimeStatePath: string) {
	if (runtimeStatePath.length === 0) throw new Error('Runtime state path is empty')
	return resolve(`${runtimeStatePath}.carry-proof-journal.json`)
}

function errorCode(error: unknown) {
	if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return undefined
	return error.code
}

async function readOwnerOnlyFile(path: string, subject: string) {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isFile()) throw new Error(`${subject} ${path} must be a regular file`)
		if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${subject} ${path} must have owner-only mode 0600`)
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${subject} ${path} must be owned by the bot process user`)
		return await handle.readFile()
	} catch (error) {
		if (errorCode(error) === 'ELOOP') throw new Error(`${subject} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

function payloadChecksum(payload: Uint8Array) {
	return keccak256(toHex(payload))
}

function parseSegmentedEnvelope(contents: string): SegmentedJournalEnvelope | undefined {
	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
	if (!isRecord(value) || value['format'] !== SEGMENTED_JOURNAL_ENVELOPE_FORMAT) return undefined
	const label = 'segmented carry proof journal envelope'
	exactKeys(value, ['format', 'payloadBytes', 'payloadChecksum', 'segments'], label)
	const payloadBytes = stringField(value, 'payloadBytes', label)
	positiveUint(payloadBytes, `${label}.payloadBytes`)
	const segmentsValue = value['segments']
	if (!Array.isArray(segmentsValue) || segmentsValue.length === 0) throw new Error(`${label}.segments must be a nonempty array`)
	const files = new Set<string>()
	const segments = segmentsValue.map((entry, index) => {
		const entryLabel = `${label}.segments[${index.toString()}]`
		const record = requiredRecord(entry, entryLabel)
		exactKeys(record, ['bytes', 'checksum', 'file'], entryLabel)
		const file = stringField(record, 'file', entryLabel)
		if (!/^[A-Za-z0-9._-]+\.segment\.[0-9a-f-]{36}\.\d+\.part$/.test(file) || basename(file) !== file) throw new Error(`${entryLabel}.file is not a safe carry-journal segment name`)
		if (files.has(file)) throw new Error(`${label} contains duplicate segment ${file}`)
		files.add(file)
		const bytes = stringField(record, 'bytes', entryLabel)
		const byteCount = positiveUint(bytes, `${entryLabel}.bytes`)
		if (byteCount > BigInt(CARRY_PROOF_JOURNAL_SEGMENT_BYTES)) throw new Error(`${entryLabel}.bytes exceeds the segment size`)
		return {
			bytes,
			checksum: hash(stringField(record, 'checksum', entryLabel), `${entryLabel}.checksum`),
			file,
		}
	})
	return {
		format: SEGMENTED_JOURNAL_ENVELOPE_FORMAT,
		payloadBytes,
		payloadChecksum: hash(stringField(value, 'payloadChecksum', label), `${label}.payloadChecksum`),
		segments,
	}
}

async function readCarryProofJournalFile(path: string, expected: CarryProofJournalExpectedIdentity) {
	const mainPayload = await readOwnerOnlyFile(path, 'Carry proof journal')
	const contents = mainPayload.toString('utf8')
	const segmented = parseSegmentedEnvelope(contents)
	if (segmented === undefined) return parseCarryProofJournal(contents, expected)
	const chunks: Buffer[] = []
	let totalBytes = 0n
	for (const segment of segmented.segments) {
		const chunk = await readOwnerOnlyFile(join(dirname(path), segment.file), 'Carry proof journal segment')
		if (BigInt(chunk.byteLength) !== BigInt(segment.bytes)) throw new Error(`Carry proof journal segment ${segment.file} byte length does not match its manifest`)
		if (payloadChecksum(chunk).toLowerCase() !== segment.checksum.toLowerCase()) throw new Error(`Carry proof journal segment ${segment.file} checksum does not match its manifest`)
		totalBytes += BigInt(chunk.byteLength)
		chunks.push(chunk)
	}
	if (totalBytes !== BigInt(segmented.payloadBytes)) throw new Error('Carry proof journal segmented payload byte length does not match its manifest')
	const payload = Buffer.concat(chunks)
	if (payloadChecksum(payload).toLowerCase() !== segmented.payloadChecksum.toLowerCase()) throw new Error('Carry proof journal segmented payload checksum does not match its manifest')
	return parseCarryProofJournal(payload.toString('utf8'), expected)
}

export async function loadCarryProofJournal(runtimeStatePath: string, identity: CarryProofJournalIdentity) {
	const path = carryProofJournalSidecarPath(runtimeStatePath)
	try {
		return await readCarryProofJournalFile(path, expectedIdentity(identity))
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return createCarryProofJournal(identity)
		throw error
	}
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

/**
 * Preserves an incompatible derived sidecar during an already-authorized,
 * no-pending-transaction deployment-profile reset. Callers must never use this
 * as recovery from corruption or an unexpected identity mismatch.
 */
export async function archiveCarryProofJournalForProfileReset(runtimeStatePath: string) {
	const path = carryProofJournalSidecarPath(runtimeStatePath)
	const pendingWrite = journalWriteQueues.get(path)
	if (pendingWrite !== undefined) await pendingWrite
	let metadata: Awaited<ReturnType<typeof lstat>>
	try {
		metadata = await lstat(path)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined
		throw error
	}
	if (metadata.isSymbolicLink()) throw new Error(`Carry proof journal ${path} must not be a symbolic link`)
	if (!metadata.isFile()) throw new Error(`Carry proof journal ${path} must be a regular file`)
	if ((metadata.mode & 0o777) !== 0o600) throw new Error(`Carry proof journal ${path} must have owner-only mode 0600`)
	if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`Carry proof journal ${path} must be owned by the bot process user`)
	const archivedPath = `${path}.profile-reset.${Date.now().toString()}.${randomUUID()}`
	await rename(path, archivedPath)
	const directoryHandle = await open(dirname(path), 'r')
	try {
		await directoryHandle.sync()
	} finally {
		await directoryHandle.close()
	}
	return archivedPath
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
		const contents = (await readOwnerOnlyFile(path, 'Carry proof journal')).toString('utf8')
		return parseSegmentedEnvelope(contents)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined
		throw error
	}
}

function segmentedPayload(path: string, contents: string, reusable: SegmentedJournalEnvelope | undefined) {
	const payload = Buffer.from(contents, 'utf8')
	if (payload.byteLength <= CARRY_PROOF_JOURNAL_SEGMENT_BYTES) return { mainContents: contents, segments: [] }
	const generation = randomUUID()
	const segments: Array<{ contents: Buffer; created: boolean; descriptor: JournalSegmentDescriptor; path: string }> = []
	for (let offset = 0, index = 0; offset < payload.byteLength; offset += CARRY_PROOF_JOURNAL_SEGMENT_BYTES, index += 1) {
		const chunk = payload.subarray(offset, Math.min(offset + CARRY_PROOF_JOURNAL_SEGMENT_BYTES, payload.byteLength))
		const checksum = payloadChecksum(chunk)
		const previous = reusable?.segments[index]
		const reused = previous !== undefined && previous.bytes === chunk.byteLength.toString() && previous.checksum.toLowerCase() === checksum.toLowerCase()
		const file = reused ? previous.file : `${basename(path)}.segment.${generation}.${index.toString().padStart(8, '0')}.part`
		segments.push({
			contents: chunk,
			created: !reused,
			descriptor: { bytes: chunk.byteLength.toString(), checksum, file },
			path: join(dirname(path), file),
		})
	}
	const envelope: SegmentedJournalEnvelope = {
		format: SEGMENTED_JOURNAL_ENVELOPE_FORMAT,
		payloadBytes: payload.byteLength.toString(),
		payloadChecksum: payloadChecksum(payload),
		segments: segments.map(segment => segment.descriptor),
	}
	return { mainContents: `${JSON.stringify(envelope, undefined, 2)}\n`, segments }
}

async function syncDirectory(path: string) {
	const directoryHandle = await open(dirname(path), 'r')
	try {
		await directoryHandle.sync()
	} finally {
		await directoryHandle.close()
	}
}

async function persistCarryProofJournal(path: string, journal: CarryProofJournal, contents: string) {
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	await assertSidecarIsNotSymlink(path)
	const oldEnvelope = await currentSegmentEnvelope(path)
	const oldSegments = oldEnvelope?.segments.map(segment => join(dirname(path), segment.file)) ?? []
	const persisted = segmentedPayload(path, contents, oldEnvelope)
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	const createdSegments: string[] = []
	let committed = false
	try {
		for (const segment of persisted.segments) {
			if (!segment.created) continue
			await writeOwnerOnlyFile(segment.path, segment.contents)
			createdSegments.push(segment.path)
		}
		if (createdSegments.length > 0) await syncDirectory(path)
		await writeOwnerOnlyFile(temporaryPath, persisted.mainContents)
		await readCarryProofJournalFile(temporaryPath, expectedIdentity(journal))
		await assertSidecarIsNotSymlink(path)
		await rename(temporaryPath, path)
		committed = true
		await syncDirectory(path)
		const retained = new Set(persisted.segments.map(segment => segment.path))
		await Promise.all(oldSegments.filter(segment => !retained.has(segment)).map(segment => rm(segment, { force: true })))
		if (oldSegments.length > 0) await syncDirectory(path)
	} catch (error) {
		await rm(temporaryPath, { force: true })
		if (!committed) await Promise.all(createdSegments.map(segment => rm(segment, { force: true })))
		throw error
	}
}

export async function saveCarryProofJournal(runtimeStatePath: string, journal: CarryProofJournal) {
	const normalized = validateCarryProofJournal(journal)
	const path = carryProofJournalSidecarPath(runtimeStatePath)
	const contents = serializedCarryProofJournal(normalized)
	const previous = journalWriteQueues.get(path)
	const write = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined)).then(() => persistCarryProofJournal(path, normalized, contents))
	const tracked = write.finally(() => {
		if (journalWriteQueues.get(path) === tracked) journalWriteQueues.delete(path)
	})
	journalWriteQueues.set(path, tracked)
	await tracked
}
