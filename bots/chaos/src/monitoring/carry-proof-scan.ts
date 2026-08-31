import { createHash } from 'node:crypto'
import { encodeAbiParameters, getAddress, hexToBytes, keccak256, toHex, zeroAddress, zeroHash, type Address, type Chain, type Hash, type Hex, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import { logRangeLimitError } from '@zoltar/bot-shared/monitoring/block-sync'
import type { OperatorSettings } from '../config/settings.ts'
import { escalationGameAbi, securityPoolAbi, securityPoolForkerAbi, zoltarAbi } from '../contracts/abi.ts'
import { eventTopic } from '../operations/planning.ts'
import type { ForkedCarryWithdrawalPresenceSnapshot, ForkedCarryWithdrawalSnapshot } from '../operations/types.ts'
import { carryCommitment, computeNullifierRootFromProof, sparseNullifierRoot, type CarryOutcome, type CarryTriple } from './carry-proof-index.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency } from './discovery.ts'
import {
	appendCarryProofJournalEventsWithCompaction,
	CARRY_DEPOSIT_CONSUMED_SIGNATURE,
	carryProofJournalDigest,
	CLAIM_DEPOSIT_SIGNATURE,
	compactCarryProofJournal,
	createCarryProofJournalIncrementalReplay,
	createCarryProofJournal,
	DISPUTE_STAKED_REP_DRAINED_SIGNATURE,
	FORK_CARRY_CHECKPOINT_SIGNATURE,
	LOCAL_DEPOSIT_APPENDED_SIGNATURE,
	replayCarryProofJournal,
	SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE,
	shouldCompactCarryProofJournal,
	TRUTH_AUCTION_HAIRCUT_SIGNATURE,
	validateCarryProofJournal,
	type CarryJournalPosition,
	type CarryProofJournal,
	type CarryProofJournalEvent,
	type TruthAuctionHaircutJournalEvent,
} from './carry-proof-journal.ts'

type CarryScanClient = PublicClient<Transport, Chain>

export interface CarryScanRoute {
	pool: Address
	escalationGame: Address
}

export interface CarryProofScanContext {
	client: CarryScanClient
	chainId: number
	profileId: string
	securityPoolForker: Address
	wallet: Address
	escalationGames: readonly CarryScanRoute[]
	knownPools: readonly Address[]
	startBlock: bigint
	anchorBlockNumber: bigint
	expectedAnchorHash: Hash
	maxBlockSpan: bigint
	previous?: CarryProofJournal
}

export interface CarryProofScanUpdate {
	journal: CarryProofJournal
	journalDigest: Hash
	digest: Hash
	complete: boolean
	reset: boolean
	fromBlock: string
	toBlock: string
	withdrawals: ForkedCarryWithdrawalSnapshot[]
	withdrawalPresence: ForkedCarryWithdrawalPresenceSnapshot[]
	withdrawalsDigest: Hash
	withdrawalCandidateCount: number
}

type CanonicalLog = {
	address: Address
	blockHash?: Hash | null | undefined
	blockNumber?: bigint | null | undefined
	data: Hex
	logIndex?: bigint | number | null | undefined
	removed?: boolean | undefined
	topics: readonly Hash[]
	transactionHash?: Hash | null | undefined
	transactionIndex?: bigint | number | null | undefined
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const UINT256_LIMIT = 1n << 256n
export const CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES = 32
export const CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE = 16_384
const LOCAL_DEPOSIT_APPENDED_TOPIC = eventTopic(LOCAL_DEPOSIT_APPENDED_SIGNATURE)
const FORK_CARRY_CHECKPOINT_TOPIC = eventTopic(FORK_CARRY_CHECKPOINT_SIGNATURE)
const CARRY_DEPOSIT_CONSUMED_TOPIC = eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE)
const CLAIM_DEPOSIT_TOPIC = eventTopic(CLAIM_DEPOSIT_SIGNATURE)
const TRUTH_AUCTION_HAIRCUT_TOPIC = eventTopic(TRUTH_AUCTION_HAIRCUT_SIGNATURE)
const DISPUTE_STAKED_REP_DRAINED_TOPIC = eventTopic(DISPUTE_STAKED_REP_DRAINED_SIGNATURE)
const SECURITY_POOL_FORK_SNAPSHOT_TOPIC = eventTopic(SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE)
const CARRY_TOPIC0_FILTER = [LOCAL_DEPOSIT_APPENDED_TOPIC, FORK_CARRY_CHECKPOINT_TOPIC, CARRY_DEPOSIT_CONSUMED_TOPIC, CLAIM_DEPOSIT_TOPIC, TRUTH_AUCTION_HAIRCUT_TOPIC, DISPUTE_STAKED_REP_DRAINED_TOPIC, SECURITY_POOL_FORK_SNAPSHOT_TOPIC] as const
const CARRY_TOPICS = new Set(CARRY_TOPIC0_FILTER.map(topic => topic.toLowerCase()))
const CONSUMED_NULLIFIER_LEAF = toHex(1n, { size: 32 })

class CarryCanonicalHistoryMismatchError extends Error {}

function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

function requireHash(value: string | undefined, label: string): Hash {
	if (value === undefined || !HASH_PATTERN.test(value)) throw new Error(`${label} must be a 32-byte hash`)
	return toHex(BigInt(value), { size: 32 })
}

function canonicalOrdinal(value: bigint | number, label: string) {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`)
		return BigInt(value)
	}
	if (value < 0n) throw new Error(`${label} is invalid`)
	return value
}

function orderedCanonicalLogs(logs: readonly CanonicalLog[], fromBlock: bigint, toBlock: bigint) {
	const identities = new Set<string>()
	const transactionHashByPosition = new Map<string, Hash>()
	const transactionIndexByHash = new Map<string, bigint>()
	for (const log of logs) {
		if (log.removed) throw new Error('Carry proof scan returned a removed canonical log')
		if (log.blockHash == null || log.blockNumber == null || log.transactionHash == null || log.transactionIndex == null || log.logIndex == null) {
			throw new Error('Carry proof scan returned a log without a canonical position')
		}
		requireHash(log.blockHash, 'Carry log block hash')
		if (log.blockNumber < fromBlock || log.blockNumber > toBlock) throw new Error('Carry proof scan returned a log outside the requested block range')
		const transactionIndex = canonicalOrdinal(log.transactionIndex, 'Carry log transaction index')
		const logIndex = canonicalOrdinal(log.logIndex, 'Carry log index')
		const transactionHash = requireHash(log.transactionHash, 'Carry log transaction hash')
		const transactionPosition = `${log.blockNumber.toString()}:${transactionIndex.toString()}`
		const positionedHash = transactionHashByPosition.get(transactionPosition)
		if (positionedHash !== undefined && positionedHash.toLowerCase() !== transactionHash.toLowerCase()) {
			throw new Error(`Carry proof scan returned distinct transaction hashes at block transaction position ${transactionPosition}`)
		}
		transactionHashByPosition.set(transactionPosition, transactionHash)
		const transactionIdentity = `${log.blockNumber.toString()}:${transactionHash.toLowerCase()}`
		const identifiedIndex = transactionIndexByHash.get(transactionIdentity)
		if (identifiedIndex !== undefined && identifiedIndex !== transactionIndex) {
			throw new Error(`Carry proof scan returned transaction ${transactionHash} at multiple indexes in block ${log.blockNumber.toString()}`)
		}
		transactionIndexByHash.set(transactionIdentity, transactionIndex)
		const identity = `${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${logIndex.toString()}`
		if (identities.has(identity)) throw new Error(`Carry proof scan returned duplicate log ${identity}`)
		identities.add(identity)
		if (transactionIndex >= UINT256_LIMIT || logIndex >= UINT256_LIMIT) throw new Error('Carry log ordinal exceeds uint256')
	}
	return [...logs].sort((left, right) => {
		if (left.blockNumber == null || right.blockNumber == null || left.transactionIndex == null || right.transactionIndex == null || left.logIndex == null || right.logIndex == null) {
			throw new Error('Carry proof scan lost a canonical log position')
		}
		if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
		const leftTransaction = canonicalOrdinal(left.transactionIndex, 'Carry log transaction index')
		const rightTransaction = canonicalOrdinal(right.transactionIndex, 'Carry log transaction index')
		if (leftTransaction !== rightTransaction) return leftTransaction < rightTransaction ? -1 : 1
		const leftIndex = canonicalOrdinal(left.logIndex, 'Carry log index')
		const rightIndex = canonicalOrdinal(right.logIndex, 'Carry log index')
		if (leftIndex === rightIndex) return 0
		return leftIndex < rightIndex ? -1 : 1
	})
}

async function boundedCarryLogPrefix(client: CarryScanClient, addresses: readonly Address[], fromBlock: bigint, toBlock: bigint): Promise<{ logs: readonly CanonicalLog[]; toBlock: bigint }> {
	try {
		const logs = await client.getLogs({ address: [...addresses], fromBlock, toBlock, topics: [[...CARRY_TOPIC0_FILTER]] })
		if (logs.length <= CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE) return { logs, toBlock }
		if (fromBlock === toBlock) {
			throw new Error(`Carry proof scan block ${fromBlock.toString()} exceeds its ${CARRY_PROOF_SCAN_MAXIMUM_LOGS_PER_RESPONSE.toString()}-log response safety limit`)
		}
	} catch (error) {
		if (!logRangeLimitError(error) || fromBlock === toBlock) throw error
	}
	const midpoint = fromBlock + (toBlock - fromBlock) / 2n
	return await boundedCarryLogPrefix(client, addresses, fromBlock, midpoint)
}

function readUnsigned(bytes: Uint8Array, offset: number, label: string) {
	if (offset < 0 || offset + 32 > bytes.length) throw new Error(`${label} ABI word is incomplete`)
	let value = 0n
	for (let index = offset; index < offset + 32; index += 1) {
		const byte = bytes[index]
		if (byte === undefined) throw new Error(`${label} ABI word is incomplete`)
		value = (value << 8n) | BigInt(byte)
	}
	return value
}

function dataWords(data: Hex, count: number, label: string) {
	const bytes = hexToBytes(data)
	if (bytes.length !== count * 32) throw new Error(`${label} has ${bytes.length.toString()} data bytes instead of ${(count * 32).toString()}`)
	return bytes
}

function wordHash(bytes: Uint8Array, word: number, label: string): Hash {
	return requireHash(toHex(readUnsigned(bytes, word * 32, label), { size: 32 }), label)
}

function wordBoolean(bytes: Uint8Array, word: number, label: string) {
	const value = readUnsigned(bytes, word * 32, label)
	if (value !== 0n && value !== 1n) throw new Error(`${label} is not a canonical ABI boolean`)
	return value === 1n
}

function strictTopicUnsigned(topic: Hash | undefined, bits: number, label: string) {
	if (topic === undefined || !HASH_PATTERN.test(topic)) throw new Error(`${label} topic is missing or malformed`)
	const value = BigInt(topic)
	if (value >= 1n << BigInt(bits)) throw new Error(`${label} topic exceeds uint${bits.toString()}`)
	return value
}

function strictTopicAddress(topic: Hash | undefined, label: string) {
	const value = strictTopicUnsigned(topic, 160, label)
	return getAddress(toHex(value, { size: 20 }))
}

function position(log: CanonicalLog): CarryJournalPosition {
	if (log.blockHash == null || log.blockNumber == null || log.transactionHash == null || log.transactionIndex == null || log.logIndex == null) {
		throw new Error('Carry log is missing its canonical position')
	}
	return {
		blockHash: requireHash(log.blockHash, 'Carry log block hash'),
		blockNumber: log.blockNumber.toString(),
		logIndex: canonicalOrdinal(log.logIndex, 'Carry log index').toString(),
		transactionHash: requireHash(log.transactionHash, 'Carry log transaction hash'),
		transactionIndex: canonicalOrdinal(log.transactionIndex, 'Carry log transaction index').toString(),
	}
}

function outcome(value: bigint, label: string): CarryOutcome {
	if (value !== 0n && value !== 1n && value !== 2n) throw new Error(`${label} must be Invalid, Yes, or No`)
	if (value === 0n) return 0
	return value === 1n ? 1 : 2
}

function carryReason(value: bigint): 0 | 1 | 2 | 3 | 4 {
	if (value !== 0n && value !== 1n && value !== 2n && value !== 3n && value !== 4n) throw new Error('CarryDepositConsumed reason is outside the known enum')
	if (value === 0n) return 0
	if (value === 1n) return 1
	if (value === 2n) return 2
	return value === 3n ? 3 : 4
}

function triple<T>(first: T, second: T, third: T): CarryTriple<T> {
	return [first, second, third]
}

function decodeGameEvent(log: CanonicalLog, route: CarryScanRoute, sourceRouteByGame: ReadonlyMap<string, CarryScanRoute>, incrementalReplay: ReturnType<typeof createCarryProofJournalIncrementalReplay>): CarryProofJournalEvent | undefined {
	const topic0 = log.topics[0]
	if (topic0 === undefined || !CARRY_TOPICS.has(topic0.toLowerCase())) return undefined
	const base = { emitter: route.escalationGame, pool: route.pool, position: position(log) }
	if (topic0.toLowerCase() === LOCAL_DEPOSIT_APPENDED_TOPIC.toLowerCase()) {
		if (log.topics.length !== 4) throw new Error('LocalDepositAppended has an invalid indexed-field count')
		const bytes = dataWords(log.data, 3, 'LocalDepositAppended')
		return {
			...base,
			amountAttoRep: readUnsigned(bytes, 0, 'LocalDepositAppended amount').toString(),
			cumulativeAmountAttoRep: readUnsigned(bytes, 64, 'LocalDepositAppended cumulative amount').toString(),
			depositor: strictTopicAddress(log.topics[3], 'LocalDepositAppended depositor'),
			kind: 'local-deposit-appended',
			nodeId: strictTopicUnsigned(log.topics[1], 256, 'LocalDepositAppended node id').toString(),
			outcome: outcome(strictTopicUnsigned(log.topics[2], 8, 'LocalDepositAppended outcome'), 'LocalDepositAppended outcome'),
			parentDepositIndex: readUnsigned(bytes, 32, 'LocalDepositAppended parent deposit index').toString(),
			signature: LOCAL_DEPOSIT_APPENDED_SIGNATURE,
		}
	}
	if (topic0.toLowerCase() === FORK_CARRY_CHECKPOINT_TOPIC.toLowerCase()) {
		if (log.topics.length !== 3) throw new Error('ForkCarryCheckpoint has an invalid indexed-field count')
		const bytes = dataWords(log.data, 15, 'ForkCarryCheckpoint')
		const sourceGame = strictTopicAddress(log.topics[1], 'ForkCarryCheckpoint source game')
		const sourceRoute = sourceRouteByGame.get(sourceGame.toLowerCase())
		if (sourceRoute === undefined) throw new Error(`ForkCarryCheckpoint source game ${sourceGame} has no discovered pool route`)
		return {
			...base,
			carryRoots: triple(wordHash(bytes, 0, 'ForkCarryCheckpoint carry root 0'), wordHash(bytes, 1, 'ForkCarryCheckpoint carry root 1'), wordHash(bytes, 2, 'ForkCarryCheckpoint carry root 2')),
			kind: 'fork-carry-checkpoint',
			leafCounts: triple(readUnsigned(bytes, 192, 'ForkCarryCheckpoint leaf count 0').toString(), readUnsigned(bytes, 224, 'ForkCarryCheckpoint leaf count 1').toString(), readUnsigned(bytes, 256, 'ForkCarryCheckpoint leaf count 2').toString()),
			nullifierRoots: triple(wordHash(bytes, 3, 'ForkCarryCheckpoint nullifier root 0'), wordHash(bytes, 4, 'ForkCarryCheckpoint nullifier root 1'), wordHash(bytes, 5, 'ForkCarryCheckpoint nullifier root 2')),
			resolutionBalancesAttoRep: triple(readUnsigned(bytes, 384, 'ForkCarryCheckpoint resolution balance 0').toString(), readUnsigned(bytes, 416, 'ForkCarryCheckpoint resolution balance 1').toString(), readUnsigned(bytes, 448, 'ForkCarryCheckpoint resolution balance 2').toString()),
			signature: FORK_CARRY_CHECKPOINT_SIGNATURE,
			snapshotId: requireHash(log.topics[2], 'ForkCarryCheckpoint snapshot id'),
			sourceGame,
			sourcePool: sourceRoute.pool,
			unresolvedTotalsAttoRep: triple(readUnsigned(bytes, 288, 'ForkCarryCheckpoint unresolved total 0').toString(), readUnsigned(bytes, 320, 'ForkCarryCheckpoint unresolved total 1').toString(), readUnsigned(bytes, 352, 'ForkCarryCheckpoint unresolved total 2').toString()),
		}
	}
	if (topic0.toLowerCase() === CARRY_DEPOSIT_CONSUMED_TOPIC.toLowerCase()) {
		if (log.topics.length !== 4) throw new Error('CarryDepositConsumed has an invalid indexed-field count')
		const bytes = dataWords(log.data, 6, 'CarryDepositConsumed')
		return {
			...base,
			amountAttoRep: readUnsigned(bytes, 32, 'CarryDepositConsumed amount').toString(),
			depositor: strictTopicAddress(log.topics[3], 'CarryDepositConsumed depositor'),
			kind: 'carry-deposit-consumed',
			outcome: outcome(readUnsigned(bytes, 0, 'CarryDepositConsumed outcome'), 'CarryDepositConsumed outcome'),
			parentDepositIndex: strictTopicUnsigned(log.topics[1], 256, 'CarryDepositConsumed parent deposit index').toString(),
			reason: carryReason(readUnsigned(bytes, 64, 'CarryDepositConsumed reason')),
			resultingCarryRoot: wordHash(bytes, 5, 'CarryDepositConsumed resulting carry root'),
			resultingNullifierRoot: wordHash(bytes, 4, 'CarryDepositConsumed resulting nullifier root'),
			resultingUnresolvedTotalAttoRep: readUnsigned(bytes, 96, 'CarryDepositConsumed resulting unresolved total').toString(),
			signature: CARRY_DEPOSIT_CONSUMED_SIGNATURE,
			sourceNodeId: strictTopicUnsigned(log.topics[2], 256, 'CarryDepositConsumed source node id').toString(),
		}
	}
	if (topic0.toLowerCase() === CLAIM_DEPOSIT_TOPIC.toLowerCase()) {
		if (log.topics.length !== 4) throw new Error('ClaimDeposit has an invalid indexed-field count')
		const bytes = dataWords(log.data, 4, 'ClaimDeposit')
		return {
			...base,
			amountToWithdrawAttoRep: readUnsigned(bytes, 32, 'ClaimDeposit withdrawal amount').toString(),
			burnAmountAttoRep: readUnsigned(bytes, 64, 'ClaimDeposit burn amount').toString(),
			depositor: strictTopicAddress(log.topics[1], 'ClaimDeposit depositor'),
			kind: 'claim-deposit',
			originalDepositAmountAttoRep: readUnsigned(bytes, 0, 'ClaimDeposit original amount').toString(),
			outcome: outcome(strictTopicUnsigned(log.topics[2], 8, 'ClaimDeposit outcome'), 'ClaimDeposit outcome'),
			parentDepositIndex: strictTopicUnsigned(log.topics[3], 256, 'ClaimDeposit parent deposit index').toString(),
			signature: CLAIM_DEPOSIT_SIGNATURE,
			transferredRep: wordBoolean(bytes, 3, 'ClaimDeposit transferredRep'),
		}
	}
	if (topic0.toLowerCase() === TRUTH_AUCTION_HAIRCUT_TOPIC.toLowerCase()) {
		if (log.topics.length !== 1) throw new Error('TruthAuctionHaircutApplied has an invalid indexed-field count')
		const bytes = dataWords(log.data, 4, 'TruthAuctionHaircutApplied')
		const repBeforeAttoRep = readUnsigned(bytes, 0, 'TruthAuctionHaircutApplied REP before').toString()
		const repRemainingAttoRep = readUnsigned(bytes, 64, 'TruthAuctionHaircutApplied REP remaining').toString()
		const accounting = incrementalReplay.deriveTruthAuctionHaircutAccounting({
			game: route.escalationGame,
			pool: route.pool,
			repBeforeAttoRep,
			repRemainingAttoRep,
		})
		return {
			...base,
			kind: 'truth-auction-haircut',
			rebasedElapsed: readUnsigned(bytes, 96, 'TruthAuctionHaircutApplied rebased elapsed').toString(),
			repBeforeAttoRep,
			repRemainingAttoRep,
			repRemovedAttoRep: readUnsigned(bytes, 32, 'TruthAuctionHaircutApplied REP removed').toString(),
			resultingResolutionBalancesAttoRep: accounting.resolutionBalancesAttoRep,
			resultingUnresolvedTotalsAttoRep: accounting.unresolvedTotalsAttoRep,
			signature: TRUTH_AUCTION_HAIRCUT_SIGNATURE,
		}
	}
	throw new Error(`Forker-only carry event ${topic0} was emitted by escalation game ${route.escalationGame}`)
}

function decodeForkerEvent(log: CanonicalLog, securityPoolForker: Address, routeByGame: ReadonlyMap<string, CarryScanRoute>, knownPools: ReadonlySet<string>): CarryProofJournalEvent | undefined {
	const topic0 = log.topics[0]
	if (topic0 === undefined || !CARRY_TOPICS.has(topic0.toLowerCase())) return undefined
	if (topic0.toLowerCase() === DISPUTE_STAKED_REP_DRAINED_TOPIC.toLowerCase()) {
		if (log.topics.length !== 3) throw new Error('DisputeStakedRepDrainedAtFork has an invalid indexed-field count')
		const pool = strictTopicAddress(log.topics[1], 'DisputeStakedRepDrainedAtFork parent pool')
		const sourceGame = strictTopicAddress(log.topics[2], 'DisputeStakedRepDrainedAtFork source game')
		const sourceRoute = routeByGame.get(sourceGame.toLowerCase())
		if (sourceRoute === undefined || !sameAddress(sourceRoute.pool, pool)) throw new Error('DisputeStakedRepDrainedAtFork source game does not belong to its indexed parent pool')
		const bytes = dataWords(log.data, 1, 'DisputeStakedRepDrainedAtFork')
		return {
			amountAttoRep: readUnsigned(bytes, 0, 'DisputeStakedRepDrainedAtFork amount').toString(),
			emitter: securityPoolForker,
			kind: 'dispute-staked-rep-drained-at-fork',
			pool,
			position: position(log),
			signature: DISPUTE_STAKED_REP_DRAINED_SIGNATURE,
			sourceGame,
		}
	}
	if (topic0.toLowerCase() === SECURITY_POOL_FORK_SNAPSHOT_TOPIC.toLowerCase()) {
		if (log.topics.length !== 3) throw new Error('SecurityPoolForkSnapshot has an invalid indexed-field count')
		const pool = strictTopicAddress(log.topics[1], 'SecurityPoolForkSnapshot parent pool')
		if (!knownPools.has(pool.toLowerCase())) throw new Error(`SecurityPoolForkSnapshot parent pool ${pool} was not discovered`)
		const bytes = dataWords(log.data, 11, 'SecurityPoolForkSnapshot')
		return {
			auctionableAttoRepAtFork: readUnsigned(bytes, 128, 'SecurityPoolForkSnapshot auctionable REP').toString(),
			emitter: securityPoolForker,
			escalationChildRepAtForkAttoRep: readUnsigned(bytes, 192, 'SecurityPoolForkSnapshot child REP').toString(),
			escalationElapsedAtFork: readUnsigned(bytes, 288, 'SecurityPoolForkSnapshot elapsed').toString(),
			escalationNonDecisionThresholdAtForkAttoRep: readUnsigned(bytes, 256, 'SecurityPoolForkSnapshot non-decision threshold').toString(),
			escalationSnapshotId: wordHash(bytes, 10, 'SecurityPoolForkSnapshot escalation snapshot id'),
			escalationSourceRepAtForkAttoRep: readUnsigned(bytes, 160, 'SecurityPoolForkSnapshot source REP').toString(),
			escalationStartBondAtForkAttoRep: readUnsigned(bytes, 224, 'SecurityPoolForkSnapshot start bond').toString(),
			kind: 'security-pool-fork-snapshot',
			migrationProxy: strictTopicAddress(log.topics[2], 'SecurityPoolForkSnapshot migration proxy'),
			ownFork: wordBoolean(bytes, 0, 'SecurityPoolForkSnapshot ownFork'),
			pool,
			position: position(log),
			settlementCollateralAtForkAttoEth: readUnsigned(bytes, 64, 'SecurityPoolForkSnapshot settlement collateral').toString(),
			signature: SECURITY_POOL_FORK_SNAPSHOT_SIGNATURE,
			totalPoolHeldRepAtForkAttoRep: readUnsigned(bytes, 96, 'SecurityPoolForkSnapshot total pool-held REP').toString(),
			unresolvedEscalation: wordBoolean(bytes, 1, 'SecurityPoolForkSnapshot unresolved escalation'),
		}
	}
	throw new Error(`Escalation-game carry event ${topic0} was emitted by the canonical SecurityPoolForker`)
}

async function canonicalBlockHash(client: CarryScanClient, blockNumber: bigint, expected?: Hash) {
	const block = await client.getBlock({ blockNumber })
	if (block.hash == null || block.number !== blockNumber) throw new Error(`Carry proof scan block ${blockNumber.toString()} has no canonical identity`)
	if (expected !== undefined && block.hash.toLowerCase() !== expected.toLowerCase()) {
		throw new CarryCanonicalHistoryMismatchError(`Carry proof scan block ${blockNumber.toString()} hash does not match the expected canonical hash`)
	}
	return block.hash
}

async function authenticateCanonicalLogBlocks(client: CarryScanClient, logs: readonly CanonicalLog[]) {
	const declaredBlocks = new Map<string, { blockHash: Hash; blockNumber: bigint }>()
	for (const log of logs) {
		if (log.blockHash == null || log.blockNumber == null) throw new Error('Carry log lost its canonical block identity')
		const blockHash = requireHash(log.blockHash, 'Carry log block hash')
		const cacheKey = log.blockNumber.toString()
		const existing = declaredBlocks.get(cacheKey)
		if (existing !== undefined && existing.blockHash.toLowerCase() !== blockHash.toLowerCase()) {
			throw new Error(`Carry proof scan returned conflicting block hashes for block ${cacheKey}`)
		}
		declaredBlocks.set(cacheKey, { blockHash, blockNumber: log.blockNumber })
	}
	const authenticated = await mapWithConcurrency([...declaredBlocks.values()], DISCOVERY_RPC_CONCURRENCY, async declaration => ({
		blockHash: await canonicalBlockHash(client, declaration.blockNumber, declaration.blockHash),
		blockNumber: declaration.blockNumber,
	}))
	return new Map(authenticated.map(({ blockHash, blockNumber }) => [blockNumber.toString(), blockHash]))
}

function validateIdentity(context: CarryProofScanContext, journal: CarryProofJournal) {
	validateCarryProofJournal(journal)
	if (journal.chainId !== context.chainId) throw new Error('Carry proof journal belongs to a different chain')
	if (journal.profileId !== context.profileId) throw new Error('Carry proof journal belongs to a different deployment profile')
	if (!sameAddress(journal.securityPoolForker, context.securityPoolForker)) throw new Error('Carry proof journal belongs to a different SecurityPoolForker')
	if (journal.startBlock !== context.startBlock.toString()) throw new Error('Carry proof journal belongs to a different protocol start block')
}

function uniqueRoutes(routes: readonly CarryScanRoute[]) {
	const byGame = new Map<string, CarryScanRoute>()
	for (const route of routes) {
		const game = getAddress(route.escalationGame)
		const pool = getAddress(route.pool)
		if (game === zeroAddress) throw new Error('Carry proof scan cannot index the zero escalation-game address')
		const existing = byGame.get(game.toLowerCase())
		if (existing !== undefined && !sameAddress(existing.pool, pool)) throw new Error(`Escalation game ${game} has conflicting discovered pool routes`)
		byGame.set(game.toLowerCase(), { escalationGame: game, pool })
	}
	return byGame
}

function truthAuctionRetention(journal: CarryProofJournal, game: Address, amountAttoRep: bigint) {
	const haircut = journal.events.find((event): event is TruthAuctionHaircutJournalEvent => event.kind === 'truth-auction-haircut' && sameAddress(event.emitter, game))
	const compactedHaircut = journal.checkpoint?.games.find(entry => sameAddress(entry.game, game))?.haircut
	const repBeforeAttoRep = haircut?.repBeforeAttoRep ?? compactedHaircut?.repBeforeAttoRep
	const repRemainingAttoRep = haircut?.repRemainingAttoRep ?? compactedHaircut?.repRemainingAttoRep
	if (repBeforeAttoRep === undefined || repRemainingAttoRep === undefined) return amountAttoRep
	return (amountAttoRep * BigInt(repRemainingAttoRep)) / BigInt(repBeforeAttoRep)
}

function exactHashes(actual: readonly Hash[], expected: readonly Hash[], label: string) {
	if (actual.length !== expected.length) throw new Error(`${label} has an invalid length`)
	for (let index = 0; index < actual.length; index += 1) {
		if (actual[index]?.toLowerCase() !== expected[index]?.toLowerCase()) throw new Error(`${label} differs at index ${index.toString()}`)
	}
}

function hashArray(value: unknown, label: string) {
	if (!Array.isArray(value)) throw new Error(`${label} is not an array`)
	return value.map((entry, index) => {
		if (typeof entry !== 'string') throw new Error(`${label} entry ${index.toString()} is not a hash`)
		return requireHash(entry, `${label} entry ${index.toString()}`)
	})
}

function proofArgument(proof: ForkedCarryWithdrawalSnapshot['proof']) {
	return {
		amountAttoRep: BigInt(proof.amountAttoRep),
		cumulativeAmountAttoRep: BigInt(proof.cumulativeAmountAttoRep),
		depositor: proof.depositor,
		leafIndex: BigInt(proof.leafIndex),
		merkleMountainRangePeakIndex: BigInt(proof.merkleMountainRangePeakIndex),
		merkleMountainRangeSiblings: proof.merkleMountainRangeSiblings,
		nullifierSiblings: proof.nullifierSiblings,
		parentDepositIndex: BigInt(proof.parentDepositIndex),
		sourceNodeId: BigInt(proof.sourceNodeId),
	}
}

function computeWinningEconomics(parameters: { actualForkThresholdAttoRep: bigint; bindingCapitalAttoRep: bigint; cumulativeAmountAttoRep: bigint; depositAmountAttoRep: bigint; nonDecisionThresholdAttoRep: bigint; winningOutcomeBalanceAttoRep: bigint }) {
	if (parameters.cumulativeAmountAttoRep < parameters.depositAmountAttoRep) throw new Error('Retained carry cumulative amount is below its deposit amount')
	if (parameters.nonDecisionThresholdAttoRep === 0n) throw new Error('Carry winning economics has a zero non-decision threshold')
	const depositStartAttoRep = parameters.cumulativeAmountAttoRep - parameters.depositAmountAttoRep
	const rewardEligibleCapAttoRep = parameters.bindingCapitalAttoRep + parameters.bindingCapitalAttoRep / 2n
	const rewardEligiblePrincipalAttoRep = parameters.winningOutcomeBalanceAttoRep < rewardEligibleCapAttoRep ? parameters.winningOutcomeBalanceAttoRep : rewardEligibleCapAttoRep
	let amountToWithdrawAttoRep = parameters.depositAmountAttoRep
	let burnAmountAttoRep = 0n
	if (rewardEligiblePrincipalAttoRep !== 0n) {
		const eligibleEndAttoRep = parameters.cumulativeAmountAttoRep < rewardEligibleCapAttoRep ? parameters.cumulativeAmountAttoRep : rewardEligibleCapAttoRep
		let rewardEligibleDepositAttoRep = eligibleEndAttoRep > depositStartAttoRep ? eligibleEndAttoRep - depositStartAttoRep : 0n
		if (rewardEligibleDepositAttoRep > parameters.depositAmountAttoRep) rewardEligibleDepositAttoRep = parameters.depositAmountAttoRep
		const bonusAttoRep = (rewardEligibleDepositAttoRep * ((parameters.bindingCapitalAttoRep * 3n) / 5n)) / rewardEligiblePrincipalAttoRep
		burnAmountAttoRep = (rewardEligibleDepositAttoRep * ((parameters.bindingCapitalAttoRep * 2n) / 5n)) / rewardEligiblePrincipalAttoRep
		amountToWithdrawAttoRep += bonusAttoRep
	}
	if (parameters.actualForkThresholdAttoRep < parameters.nonDecisionThresholdAttoRep) {
		amountToWithdrawAttoRep = (amountToWithdrawAttoRep * parameters.actualForkThresholdAttoRep) / parameters.nonDecisionThresholdAttoRep
	}
	return { amountToWithdrawAttoRep, burnAmountAttoRep }
}

async function verifiedWithdrawalCandidates(context: CarryProofScanContext, journal: CarryProofJournal, routeByGame: ReadonlyMap<string, CarryScanRoute>) {
	// Rotate the bounded page by canonical anchor so ineligible early leaves can
	// never permanently starve later wallet proofs, even on very large journals.
	const replay = replayCarryProofJournal(journal, context.wallet, CARRY_PROOF_SCAN_MAXIMUM_WITHDRAWAL_CANDIDATES, context.anchorBlockNumber)
	const candidates: ForkedCarryWithdrawalSnapshot[] = []
	const anchoredGameReads = async (candidate: (typeof replay.proofCandidates)[number], sourceRoute: CarryScanRoute) => {
		const [poolParent, poolGame, poolForker, poolState, poolResolved, gamePool, snapshotInitialized, finalResolution, poolQuestionOutcome, sourcePoolGame, directPrincipals, outcomeStates, forkSnapshot, bindingCapital, nonDecisionThreshold, gameEnd, universeId, zoltar] = await drainConcurrent([
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'parent' }),
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'escalationGame' }),
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'securityPoolForker' }),
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'systemState' }),
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'isEscalationResolved' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'securityPool' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'forkCarrySnapshotInitialized' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'getFinalQuestionResolution' }),
			context.client.readContract({ abi: securityPoolForkerAbi, address: context.securityPoolForker, args: [candidate.pool], blockNumber: context.anchorBlockNumber, functionName: 'getQuestionOutcome' }),
			context.client.readContract({ abi: securityPoolAbi, address: sourceRoute.pool, blockNumber: context.anchorBlockNumber, functionName: 'escalationGame' }),
			drainConcurrent(([0, 1, 2] as const).map(index => context.client.readContract({ abi: securityPoolForkerAbi, address: context.securityPoolForker, args: [sourceRoute.pool, index], blockNumber: context.anchorBlockNumber, functionName: 'getDirectlyClaimedEscalationPrincipal' }))),
			drainConcurrent(([0, 1, 2] as const).map(index => context.client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [index], blockNumber: context.anchorBlockNumber, functionName: 'getOutcomeState' }))),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'getForkCarrySnapshot' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'getBindingCapitalAttoRep' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber: context.anchorBlockNumber, functionName: 'getEscalationGameEndDate' }),
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'universeId' }),
			context.client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber: context.anchorBlockNumber, functionName: 'zoltar' }),
		])
		const [forkThreshold, forkTime] = await drainConcurrent([
			context.client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber: context.anchorBlockNumber, functionName: 'getForkThresholdAttoRep' }),
			context.client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber: context.anchorBlockNumber, functionName: 'getForkTime' }),
		])
		return { bindingCapital, directPrincipals, finalResolution, forkSnapshot, forkThreshold, forkTime, gameEnd, gamePool, nonDecisionThreshold, outcomeStates, poolForker, poolGame, poolParent, poolQuestionOutcome, poolResolved, poolState, snapshotInitialized, sourcePoolGame }
	}
	const anchoredReadsByGame = new Map<string, ReturnType<typeof anchoredGameReads>>()
	const validatedGames = new Set<string>()
	const currentCarryRootsByGame = new Map<string, CarryTriple<Hash>>()
	for (const candidate of replay.proofCandidates) {
		const childRoute = routeByGame.get(candidate.game.toLowerCase())
		const sourceRoute = routeByGame.get(candidate.sourceGame.toLowerCase())
		const claimSourceRoute = routeByGame.get(candidate.claimSourceGame.toLowerCase())
		const replayedGame = replay.games[candidate.game.toLowerCase()]
		if (childRoute === undefined || sourceRoute === undefined || claimSourceRoute === undefined || replayedGame === undefined) throw new Error('Carry proof candidate has an incomplete discovered claim-source/source/child graph')
		if (!sameAddress(childRoute.pool, candidate.pool)) throw new Error('Carry proof candidate pool differs from its discovered child route')
		const gameKey = candidate.game.toLowerCase()
		let anchoredReads = anchoredReadsByGame.get(gameKey)
		if (anchoredReads === undefined) {
			anchoredReads = anchoredGameReads(candidate, sourceRoute)
			anchoredReadsByGame.set(gameKey, anchoredReads)
		}
		const [anchored, directClaimed] = await drainConcurrent([
			anchoredReads,
			context.client.readContract({ abi: securityPoolForkerAbi, address: context.securityPoolForker, args: [claimSourceRoute.pool, candidate.outcome, BigInt(candidate.parentDepositIndex)], blockNumber: context.anchorBlockNumber, functionName: 'isEscalationDepositClaimedDirectly' }),
		])
		const { bindingCapital, directPrincipals, finalResolution, forkSnapshot, forkThreshold, forkTime, gameEnd, gamePool, nonDecisionThreshold, outcomeStates, poolForker, poolGame, poolParent, poolQuestionOutcome, poolResolved, poolState, snapshotInitialized, sourcePoolGame } = anchored
		if (!sameAddress(poolParent, sourceRoute.pool) || !sameAddress(poolGame, candidate.game) || !sameAddress(gamePool, candidate.pool) || !sameAddress(sourcePoolGame, candidate.sourceGame)) {
			throw new Error('Carry proof candidate source/child game and pool graph does not match the anchor')
		}
		if (!sameAddress(poolForker, context.securityPoolForker)) throw new Error('Carry proof candidate child pool uses a different SecurityPoolForker')
		const finalOutcome = BigInt(finalResolution)
		if (BigInt(poolState) !== 0n || !poolResolved || !snapshotInitialized) continue
		if (finalOutcome !== BigInt(candidate.outcome) || BigInt(poolQuestionOutcome) !== BigInt(candidate.outcome)) continue
		if (directClaimed) throw new Error('Carry proof candidate is directly claimed on-chain but absent from the canonical claim journal')
		const replayedRawAccounting = replayedGame.rawAccounting
		if (replayedRawAccounting === null) throw new Error(`Carry proof candidate game ${candidate.game} is missing canonical raw accounting`)
		const rawAccounting = {
			inheritedTotalsAttoRep: [BigInt(replayedRawAccounting.inheritedTotalsAttoRep[0]), BigInt(replayedRawAccounting.inheritedTotalsAttoRep[1]), BigInt(replayedRawAccounting.inheritedTotalsAttoRep[2])] as const,
			localTotalsAttoRep: [BigInt(replayedRawAccounting.localTotalsAttoRep[0]), BigInt(replayedRawAccounting.localTotalsAttoRep[1]), BigInt(replayedRawAccounting.localTotalsAttoRep[2])] as const,
		}
		if (!validatedGames.has(gameKey)) {
			const currentCarryRoots: [Hash, Hash, Hash] = [zeroHash, zeroHash, zeroHash]
			for (const index of [0, 1, 2] as const) {
				const replayedOutcome = replayedGame.state.outcomes[index]
				const onchain = outcomeStates[index]
				const snapshotCommitment = carryCommitment(replayedOutcome.snapshotSlots)
				const currentCommitment = carryCommitment(replayedOutcome.currentSlots)
				currentCarryRoots[index] = currentCommitment.root
				const currentNullifierRoot = sparseNullifierRoot(replayedOutcome.nullifier)
				const rawInherited = rawAccounting.inheritedTotalsAttoRep[index]
				const rawLocal = rawAccounting.localTotalsAttoRep[index]
				if (directPrincipals[index] > rawInherited) throw new Error(`Carry outcome ${index.toString()} directly claimed principal exceeds reconstructed raw inherited REP`)
				if (BigInt(replayedGame.localUnresolvedTotalsAttoRep[index]) !== rawLocal) throw new Error(`Carry outcome ${index.toString()} raw local accounting differs from replay`)
				const effectiveInherited = finalOutcome === BigInt(index) ? truthAuctionRetention(journal, candidate.game, rawInherited - directPrincipals[index]) : 0n
				const effectiveTotal = effectiveInherited + rawLocal
				if (onchain.balanceAttoRep.toString() !== replayedOutcome.resolutionBalanceAttoRep) throw new Error(`Carry outcome ${index.toString()} resolution balance differs from replay`)
				if (onchain.snapshotLeafCount.toString() !== snapshotCommitment.leafCount) throw new Error(`Carry outcome ${index.toString()} snapshot leaf count differs from replay`)
				exactHashes(onchain.snapshotPeaks, snapshotCommitment.peaks, `Carry outcome ${index.toString()} snapshot peaks`)
				if (onchain.inheritedUnresolvedTotalAttoRep !== effectiveInherited) throw new Error(`Carry outcome ${index.toString()} inherited unresolved REP differs from replay`)
				if (onchain.currentNullifierRoot.toLowerCase() !== currentNullifierRoot.toLowerCase()) throw new Error(`Carry outcome ${index.toString()} nullifier root differs from replay`)
				const localNodeIds = replayedOutcome.currentSlots.filter(slot => sameAddress(slot.originGame, candidate.game)).map(slot => BigInt(slot.leaf.sourceNodeId))
				const expectedLocalHead = localNodeIds.reduce((largest, current) => (current > largest ? current : largest), 0n)
				if (onchain.localHeadNodeId !== expectedLocalHead) throw new Error(`Carry outcome ${index.toString()} local head node differs from replay`)
				if (onchain.currentLeafCount.toString() !== currentCommitment.leafCount) throw new Error(`Carry outcome ${index.toString()} current leaf count differs from replay`)
				exactHashes(onchain.currentPeaks, currentCommitment.peaks, `Carry outcome ${index.toString()} current peaks`)
				if (onchain.localUnresolvedTotalAttoRep !== rawLocal) throw new Error(`Carry outcome ${index.toString()} local unresolved REP differs from replay`)
				if (onchain.currentCarryRoot.toLowerCase() !== currentCommitment.root.toLowerCase()) throw new Error(`Carry outcome ${index.toString()} carry root differs from replay`)
				if (onchain.currentCarryTotalAttoRep !== effectiveTotal) throw new Error(`Carry outcome ${index.toString()} carry total differs from replay`)
				const forkSnapshotPeaks = hashArray(forkSnapshot.carryPeaks[index], `Fork carry snapshot outcome ${index.toString()} peaks`)
				exactHashes(forkSnapshotPeaks, currentCommitment.peaks, `Fork carry snapshot outcome ${index.toString()} peaks`)
				if (forkSnapshot.carryLeafCounts[index].toString() !== currentCommitment.leafCount || forkSnapshot.carryTotalsAttoRep[index] !== effectiveTotal || forkSnapshot.nullifierRoots[index].toLowerCase() !== currentNullifierRoot.toLowerCase()) {
					throw new Error(`Fork carry snapshot outcome ${index.toString()} differs from replay`)
				}
			}
			currentCarryRootsByGame.set(gameKey, currentCarryRoots)
			validatedGames.add(gameKey)
		}
		const proof = {
			amountAttoRep: candidate.proof.amountAttoRep,
			cumulativeAmountAttoRep: candidate.proof.cumulativeAmountAttoRep,
			depositor: candidate.proof.depositor,
			leafIndex: candidate.proof.leafIndex,
			merkleMountainRangePeakIndex: candidate.proof.merkleMountainRangePeakIndex,
			merkleMountainRangeSiblings: [...candidate.proof.merkleMountainRangeSiblings],
			nullifierSiblings: [...candidate.proof.nullifierSiblings],
			parentDepositIndex: candidate.proof.parentDepositIndex,
			sourceNodeId: candidate.proof.sourceNodeId,
		}
		const currentCarryRoot = currentCarryRootsByGame.get(gameKey)?.[candidate.outcome]
		if (currentCarryRoot === undefined) throw new Error(`Carry proof candidate game ${candidate.game} is missing its verified current carry root`)
		const resultingNullifierRoot = computeNullifierRootFromProof(candidate.parentDepositIndex, proof.nullifierSiblings, CONSUMED_NULLIFIER_LEAF)
		const proofCallArgument = proofArgument(proof)
		const [retainedDeposit, retainedCumulative, sourceStorageBasis, gameWithdrawal, simulation] = await drainConcurrent([
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [BigInt(proof.amountAttoRep), BigInt(proof.parentDepositIndex)], blockNumber: context.anchorBlockNumber, functionName: 'applyInheritedClaimRetention' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [BigInt(proof.cumulativeAmountAttoRep), BigInt(proof.parentDepositIndex)], blockNumber: context.anchorBlockNumber, functionName: 'applyInheritedClaimRetention' }),
			context.client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [BigInt(proof.amountAttoRep), BigInt(proof.cumulativeAmountAttoRep), BigInt(proof.parentDepositIndex)], blockNumber: context.anchorBlockNumber, functionName: 'applyInheritedSourceStorageBasis' }),
			context.client.simulateContract({ account: candidate.pool, abi: escalationGameAbi, address: candidate.game, args: [proofCallArgument, candidate.outcome], blockNumber: context.anchorBlockNumber, functionName: 'withdrawDeposit' }),
			context.client.simulateContract({ account: context.wallet, abi: securityPoolAbi, address: candidate.pool, args: [candidate.outcome, [proofCallArgument]], blockNumber: context.anchorBlockNumber, functionName: 'withdrawForkedEscalationDeposits' }),
		])
		if (simulation.result !== undefined) throw new Error('Carry withdrawal simulation did not return the canonical empty result')
		const actualForkThreshold = forkTime > gameEnd ? nonDecisionThreshold : forkThreshold
		const economics = computeWinningEconomics({
			actualForkThresholdAttoRep: actualForkThreshold,
			bindingCapitalAttoRep: bindingCapital,
			cumulativeAmountAttoRep: retainedCumulative,
			depositAmountAttoRep: retainedDeposit,
			nonDecisionThresholdAttoRep: nonDecisionThreshold,
			winningOutcomeBalanceAttoRep: outcomeStates[candidate.outcome].balanceAttoRep,
		})
		if (!sameAddress(gameWithdrawal.result.depositor, candidate.depositor) || gameWithdrawal.result.originalDepositAmountAttoRep !== BigInt(candidate.amountAttoRep) || gameWithdrawal.result.amountToWithdrawAttoRep !== economics.amountToWithdrawAttoRep) {
			throw new Error('Direct carried-deposit simulation does not match the derived winning economics')
		}
		const rawInheritedBefore = rawAccounting.inheritedTotalsAttoRep[candidate.outcome]
		const rawLocalBefore = rawAccounting.localTotalsAttoRep[candidate.outcome]
		const inheritedConsumedAttoRep = sourceStorageBasis < rawInheritedBefore ? sourceStorageBasis : rawInheritedBefore
		const rawInheritedAfter = rawInheritedBefore - inheritedConsumedAttoRep
		const rawLocalConsumedAttoRep = sourceStorageBasis - inheritedConsumedAttoRep
		if (rawLocalConsumedAttoRep > rawLocalBefore) throw new Error('Carry proof source storage basis exceeds reconstructed raw carry REP')
		if (directPrincipals[candidate.outcome] > rawInheritedAfter) throw new Error('Carry proof would reduce inherited REP below directly claimed principal')
		const rawLocalAfter = rawLocalBefore - rawLocalConsumedAttoRep
		const resultingUnresolvedTotalAttoRep = truthAuctionRetention(journal, candidate.game, rawInheritedAfter - directPrincipals[candidate.outcome]) + rawLocalAfter
		candidates.push({
			amountAttoRep: candidate.amountAttoRep,
			amountToWithdrawAttoRep: economics.amountToWithdrawAttoRep.toString(),
			burnAmountAttoRep: economics.burnAmountAttoRep.toString(),
			claimSourceGame: candidate.claimSourceGame,
			depositor: candidate.depositor,
			game: candidate.game,
			outcome: candidate.outcome,
			parentDepositIndex: candidate.parentDepositIndex,
			pool: candidate.pool,
			preflightExpectedResult: '0x',
			proof,
			resultingCarryRoot: currentCarryRoot,
			resultingNullifierRoot,
			resultingUnresolvedTotalAttoRep: resultingUnresolvedTotalAttoRep.toString(),
			snapshotId: candidate.snapshotId,
			sourceGame: candidate.sourceGame,
			sourceNodeId: candidate.sourceNodeId,
			sourcePool: sourceRoute.pool,
		})
	}
	return {
		candidateCount: replay.proofCandidateCount,
		journalDigest: replay.journalDigest,
		presence: replay.proofCandidatePresence,
		withdrawals: candidates,
	}
}

export function carryProofDeploymentProfileId(settings: OperatorSettings) {
	const deployment = {
		openOracle: settings.deployment.openOracle.toLowerCase(),
		questionData: settings.deployment.questionData.toLowerCase(),
		securityPoolFactory: settings.deployment.securityPoolFactory.toLowerCase(),
		securityPoolForker: settings.deployment.securityPoolForker.toLowerCase(),
		tradingFactory: settings.deployment.tradingFactory.toLowerCase(),
		tradingRouter: settings.deployment.tradingRouter.toLowerCase(),
		weth: settings.deployment.weth.toLowerCase(),
		zoltar: settings.deployment.zoltar.toLowerCase(),
	}
	return `profile:v1:${createHash('sha256')
		.update(JSON.stringify({ chainId: settings.network.chainId, deployment }))
		.digest('hex')}`
}

export function carryUpdateMatchingDigest(updates: readonly CarryProofScanUpdate[], digest: Hash) {
	const matching = updates.filter(update => update.digest.toLowerCase() === digest.toLowerCase())
	if (matching.length === 0) throw new Error(`No carry proof scan candidate matches quorum digest ${digest}`)
	const selected = matching[0]
	if (selected === undefined) throw new Error('Carry proof scan quorum candidate is missing')
	return selected
}

export function carryUpdateMatchingCommitment(updates: readonly CarryProofScanUpdate[], commitment: { journalDigest: Hash; withdrawalsDigest: Hash }) {
	const matching = updates.filter(update => update.journalDigest.toLowerCase() === commitment.journalDigest.toLowerCase() && update.withdrawalsDigest.toLowerCase() === commitment.withdrawalsDigest.toLowerCase())
	if (matching.length === 0) throw new Error('No carry proof scan candidate matches the quorum journal and withdrawal digests')
	const selected = matching[0]
	if (selected === undefined) throw new Error('Carry proof scan quorum candidate is missing')
	return selected
}

function canonicalWithdrawalOrder(left: ForkedCarryWithdrawalSnapshot, right: ForkedCarryWithdrawalSnapshot) {
	const game = left.game.toLowerCase().localeCompare(right.game.toLowerCase())
	if (game !== 0) return game
	if (left.outcome !== right.outcome) return left.outcome - right.outcome
	const parent = BigInt(left.parentDepositIndex) - BigInt(right.parentDepositIndex)
	if (parent !== 0n) return parent < 0n ? -1 : 1
	const node = BigInt(left.sourceNodeId) - BigInt(right.sourceNodeId)
	if (node === 0n) return 0
	return node < 0n ? -1 : 1
}

export function carryProofWithdrawalsDigest(withdrawals: readonly ForkedCarryWithdrawalSnapshot[]) {
	const canonical = [...withdrawals].sort(canonicalWithdrawalOrder).map(candidate => ({
		...candidate,
		proof: {
			...candidate.proof,
			merkleMountainRangeSiblings: [...candidate.proof.merkleMountainRangeSiblings],
			nullifierSiblings: [...candidate.proof.nullifierSiblings],
		},
	}))
	return keccak256(toHex(JSON.stringify(canonical)))
}

export function carryProofScanDigest(journal: CarryProofJournal, withdrawals: readonly ForkedCarryWithdrawalSnapshot[]) {
	return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [carryProofJournalDigest(journal), carryProofWithdrawalsDigest(withdrawals)]))
}

function completedUpdateFields(journal: CarryProofJournal, withdrawals: readonly ForkedCarryWithdrawalSnapshot[], verifiedJournalDigest?: Hash) {
	const journalDigest = verifiedJournalDigest ?? carryProofJournalDigest(journal)
	const withdrawalsDigest = carryProofWithdrawalsDigest(withdrawals)
	return {
		digest: keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [journalDigest, withdrawalsDigest])),
		journalDigest,
		withdrawalsDigest,
	}
}

function compactJournalAtCursor(journal: CarryProofJournal) {
	if (!shouldCompactCarryProofJournal(journal)) return journal
	return compactCarryProofJournal(journal)
}

export async function updateCarryProofJournal(context: CarryProofScanContext): Promise<CarryProofScanUpdate> {
	if (context.startBlock < 0n || context.anchorBlockNumber < context.startBlock) throw new Error('Carry proof scan block range is invalid')
	if (context.maxBlockSpan <= 0n) throw new Error('Carry proof scan maxBlockSpan must be positive')
	await canonicalBlockHash(context.client, context.anchorBlockNumber, context.expectedAnchorHash)
	const routeByGame = uniqueRoutes(context.escalationGames)
	const knownPools = new Set(context.knownPools.map(pool => getAddress(pool).toLowerCase()))
	for (const route of routeByGame.values()) knownPools.add(route.pool.toLowerCase())
	const startHash = await canonicalBlockHash(context.client, context.startBlock)
	let reset = false
	let journal: CarryProofJournal
	if (context.previous === undefined) {
		journal = createCarryProofJournal({
			chainId: context.chainId,
			initialCursor: { blockHash: startHash, blockNumber: context.startBlock.toString() },
			profileId: context.profileId,
			securityPoolForker: context.securityPoolForker,
			startBlock: context.startBlock.toString(),
		})
	} else {
		validateIdentity(context, context.previous)
		const previousCursor = BigInt(context.previous.cursor.blockNumber)
		if (previousCursor > context.anchorBlockNumber) reset = true
		else {
			try {
				await canonicalBlockHash(context.client, previousCursor, context.previous.cursor.blockHash)
				const checkpointCutoff = context.previous.checkpoint?.cutoff
				if (checkpointCutoff !== undefined && checkpointCutoff.blockNumber !== context.previous.cursor.blockNumber) {
					await canonicalBlockHash(context.client, BigInt(checkpointCutoff.blockNumber), checkpointCutoff.blockHash)
				}
			} catch (error) {
				if (error instanceof CarryCanonicalHistoryMismatchError) reset = true
				else if (error instanceof Error) throw error
				else throw new Error('Carry proof journal canonical-history probe threw a non-Error value', { cause: error })
			}
		}
		journal = reset ? createCarryProofJournal({ chainId: context.chainId, initialCursor: { blockHash: startHash, blockNumber: context.startBlock.toString() }, profileId: context.profileId, securityPoolForker: context.securityPoolForker, startBlock: context.startBlock.toString() }) : context.previous
	}
	const cursor = BigInt(journal.cursor.blockNumber)
	const scanStartInclusive = !journal.scanStarted
	const fromBlock = scanStartInclusive ? context.startBlock : cursor + 1n
	if (fromBlock > context.anchorBlockNumber) {
		journal = compactJournalAtCursor(journal)
		const verified = await verifiedWithdrawalCandidates(context, journal, routeByGame)
		await canonicalBlockHash(context.client, context.anchorBlockNumber, context.expectedAnchorHash)
		return {
			...completedUpdateFields(journal, verified.withdrawals, verified.journalDigest),
			complete: true,
			fromBlock: fromBlock.toString(),
			journal,
			reset,
			toBlock: journal.cursor.blockNumber,
			withdrawalCandidateCount: verified.candidateCount,
			withdrawalPresence: verified.presence,
			withdrawals: verified.withdrawals,
		}
	}
	const maximumToBlock = fromBlock + context.maxBlockSpan - 1n
	const requestedToBlock = maximumToBlock < context.anchorBlockNumber ? maximumToBlock : context.anchorBlockNumber
	const addresses = [...routeByGame.values()].map(route => route.escalationGame)
	addresses.push(context.securityPoolForker)
	const boundedLogs = await boundedCarryLogPrefix(context.client, addresses, fromBlock, requestedToBlock)
	const toBlock = boundedLogs.toBlock
	const logs = orderedCanonicalLogs(boundedLogs.logs, fromBlock, toBlock)
	const blockHashes = await authenticateCanonicalLogBlocks(context.client, logs)
	const additions: CarryProofJournalEvent[] = []
	const incrementalReplay = createCarryProofJournalIncrementalReplay(journal)
	try {
		for (const log of logs) {
			if (log.blockHash == null || log.blockNumber == null) throw new Error('Carry log lost its canonical block identity')
			const cacheKey = log.blockNumber.toString()
			const knownHash = blockHashes.get(cacheKey)
			if (knownHash === undefined) throw new Error(`Carry log block ${cacheKey} was not authenticated`)
			const emitter = getAddress(log.address)
			let decoded: CarryProofJournalEvent | undefined
			if (sameAddress(emitter, context.securityPoolForker)) decoded = decodeForkerEvent(log, context.securityPoolForker, routeByGame, knownPools)
			else {
				const route = routeByGame.get(emitter.toLowerCase())
				if (route === undefined) throw new Error(`Carry proof scan returned unexpected emitter ${emitter}`)
				decoded = decodeGameEvent(log, route, routeByGame, incrementalReplay)
			}
			if (decoded !== undefined) {
				incrementalReplay.append(decoded)
				additions.push(decoded)
			}
		}
	} finally {
		// The next append/compaction and proof generation passes build their own
		// bounded replay. Release this page decoder's indexes first so their peaks
		// cannot overlap through a retained closure.
		incrementalReplay.release()
	}
	const cursorHash = toBlock === context.anchorBlockNumber ? context.expectedAnchorHash : await canonicalBlockHash(context.client, toBlock)
	journal = appendCarryProofJournalEventsWithCompaction(journal, additions, { blockHash: cursorHash, blockNumber: toBlock.toString() })
	const complete = toBlock === context.anchorBlockNumber
	const verified = complete ? await verifiedWithdrawalCandidates(context, journal, routeByGame) : { candidateCount: 0, journalDigest: undefined, presence: [], withdrawals: [] }
	await canonicalBlockHash(context.client, context.anchorBlockNumber, context.expectedAnchorHash)
	return {
		...completedUpdateFields(journal, verified.withdrawals, verified.journalDigest),
		complete,
		fromBlock: fromBlock.toString(),
		journal,
		reset,
		toBlock: toBlock.toString(),
		withdrawalCandidateCount: verified.candidateCount,
		withdrawalPresence: verified.presence,
		withdrawals: verified.withdrawals,
	}
}
