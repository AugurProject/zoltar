import { bigintToSafeNumber, encodeAbiParameters, getAddress, hexToBytes, keccak256, zeroAddress, zeroHash, type Address, type Chain, type Hash, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import { openOracleAbi } from '../contracts/abi.ts'
import type { CanonicalUintString } from '../core/units.ts'
import { eventTopic } from '../operations/planning.ts'
import type { AuctionBidSnapshot, AuctionRefundSnapshot, ChildRepSplitProgressSnapshot, EscalationDepositSnapshot, MigrationRepSplitProgressSnapshot, OracleGameSnapshot } from '../operations/types.ts'

type IndexClient = PublicClient<Transport, Chain>

export interface ProtocolIndexCursor {
	blockNumber: string
	blockHash: Hash
}

export interface ChaosProtocolIndex {
	schemaVersion: 3
	chainId: number
	openOracle: Address
	zoltar: Address
	securityPoolForker: Address
	wallet: Address
	startBlock: string
	cursor: ProtocolIndexCursor
	reports: OracleGameSnapshot[]
	auctionBids: Record<string, AuctionBidSnapshot[]>
	auctionRefunds: Record<string, AuctionRefundSnapshot>
	escalationDeposits: EscalationDepositSnapshot[]
	migrationRepSplits: MigrationRepSplitProgressSnapshot[]
	childRepSplits: ChildRepSplitProgressSnapshot[]
}

export interface UpdateProtocolIndexContext {
	client: IndexClient
	chainId: number
	openOracle: Address
	weth: Address
	zoltar: Address
	securityPoolForker: Address
	wallet: Address
	trustedRepTokens: readonly Address[]
	coordinatorReports: readonly CanonicalCoordinatorReportRoute[]
	maximumSettlementStepGasLimit: bigint
	auctionAddresses: readonly Address[]
	escalationGames: readonly { pool: Address; escalationGame: Address }[]
	startBlock: bigint
	anchorBlockNumber: bigint
	expectedAnchorHash?: Hash
	maxBlockSpan?: bigint
	previous?: ChaosProtocolIndex
}

export interface CanonicalCoordinatorReportRoute {
	coordinator: Address
	pendingReportId: string
	repToken: Address
}

export interface TrustedOpenOracleReportContext {
	openOracle: Address
	weth: Address
	wallet: Address
	trustedRepTokens: readonly Address[]
	coordinatorReports: readonly CanonicalCoordinatorReportRoute[]
	maximumSettlementStepGasLimit: bigint
}

export interface ProtocolIndexUpdate {
	index: ChaosProtocolIndex
	complete: boolean
	fromBlock: string
	toBlock: string
}

export class ChaosProtocolIndexReorgError extends Error {
	readonly rescanFromBlock: bigint

	constructor(message: string, rescanFromBlock: bigint) {
		super(message)
		this.name = 'ChaosProtocolIndexReorgError'
		this.rescanFromBlock = rescanFromBlock
	}
}

const REPORT_SUBMITTED = eventTopic('ReportSubmitted(uint256,bytes)')
const REPORT_DISPUTED = eventTopic('ReportDisputed(uint256,bytes)')
const REPORT_SETTLED = eventTopic('ReportSettled(uint256)')
const BID_SUBMITTED = eventTopic('BidSubmitted(address,int256,uint256,uint256,uint256)')
const BID_SETTLED = eventTopic('BidSettled(address,int256,uint256,uint256,uint256,uint256,uint256,uint8)')
const ETH_REFUND_DEFERRED = eventTopic('EthRefundDeferred(address,uint256,uint256)')
const PENDING_ETH_REFUND_WITHDRAWN = eventTopic('PendingEthRefundWithdrawn(address,uint256)')
const LOCAL_DEPOSIT_APPENDED = eventTopic('LocalDepositAppended(uint256,uint8,address,uint256,uint256,uint256)')
const DEPOSIT_ON_OUTCOME = eventTopic('DepositOnOutcome(address,uint8,uint256,uint256,uint256,uint256,uint256)')
const CLAIM_DEPOSIT = eventTopic('ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)')
const CARRY_DEPOSIT_CONSUMED = eventTopic('CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)')
const MIGRATION_REP_SPLIT = eventTopic('MigrationRepSplit(address,address,uint248,uint256,uint248,uint256,uint256)')
const CHILD_REP_SPLIT = eventTopic('ChildRepSplit(address,uint256,uint256,uint256)')
const UINT248_LIMIT = 1n << 248n
const MAXIMUM_ACTIVE_SIGNER_REPORTS = 64

/** Every OpenOracle settlement plan uses this explicit transaction gas limit. */
export const OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT = 12_000_000n

function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

function maximumTrustedCallbackGasLimit(maximumSettlementStepGasLimit: bigint) {
	if (maximumSettlementStepGasLimit <= 0n) throw new Error('OpenOracle settlement step gas limit must be positive')
	// Reserve one third of the transaction limit for settlement accounting,
	// callback calldata, EIP-150 headroom, and post-callback evidence events.
	return (maximumSettlementStepGasLimit * 2n) / 3n
}

function requireUnsignedReportId(value: string, label: string) {
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an unsigned integer string`)
	return BigInt(value)
}

function compiledReportTrustContext(context: TrustedOpenOracleReportContext) {
	const maximumCallbackGasLimit = maximumTrustedCallbackGasLimit(context.maximumSettlementStepGasLimit)
	const trustedRepTokens = new Set<string>()
	for (const repToken of context.trustedRepTokens) trustedRepTokens.add(getAddress(repToken).toLowerCase())
	const coordinators = new Set<string>()
	const coordinatorReports = new Map<string, { coordinator: string; repToken: string }>()
	for (const route of context.coordinatorReports) {
		const coordinator = getAddress(route.coordinator).toLowerCase()
		const repToken = getAddress(route.repToken).toLowerCase()
		const reportId = requireUnsignedReportId(route.pendingReportId, `Coordinator ${route.coordinator} pending report ID`)
		if (reportId === 0n) throw new Error(`Coordinator ${route.coordinator} trusted report route cannot use report ID zero`)
		if (!trustedRepTokens.has(repToken)) throw new Error(`Coordinator ${route.coordinator} report REP is not a canonical discovered token`)
		if (coordinators.has(coordinator)) throw new Error(`Coordinator ${route.coordinator} has duplicate trusted report routes`)
		if (coordinatorReports.has(route.pendingReportId)) throw new Error(`OpenOracle report ${route.pendingReportId} is assigned to multiple coordinators`)
		coordinators.add(coordinator)
		coordinatorReports.set(route.pendingReportId, { coordinator, repToken })
	}
	return {
		coordinatorReports,
		maximumCallbackGasLimit,
		openOracle: getAddress(context.openOracle).toLowerCase(),
		trustedRepTokens,
		wallet: getAddress(context.wallet).toLowerCase(),
		weth: getAddress(context.weth).toLowerCase(),
	}
}

/**
 * Accept only reports whose immutable preimage is bound to the configured signer
 * or to the exact current report of an authenticated pool coordinator.
 */
export function trustedOpenOracleReportPredicate(context: TrustedOpenOracleReportContext) {
	const trusted = compiledReportTrustContext(context)
	return (report: OracleGameSnapshot) => {
		if (report.openOracle.toLowerCase() !== trusted.openOracle) return false
		if (report.token1.toLowerCase() !== trusted.weth) return false
		if (!trusted.trustedRepTokens.has(report.token2.toLowerCase())) return false
		const callbackGasLimit = BigInt(report.game.callbackGasLimit)
		if (callbackGasLimit > trusted.maximumCallbackGasLimit) return false
		if (report.helper.creator.toLowerCase() === trusted.wallet) {
			return sameAddress(report.game.callbackContract, zeroAddress) && callbackGasLimit === 0n
		}
		const route = trusted.coordinatorReports.get(report.reportId)
		return route !== undefined && route.repToken === report.token2.toLowerCase() && route.coordinator === report.helper.creator.toLowerCase() && route.coordinator === report.game.callbackContract.toLowerCase()
	}
}

export function isTrustedOpenOracleReport(context: TrustedOpenOracleReportContext, report: OracleGameSnapshot) {
	return trustedOpenOracleReportPredicate(context)(report)
}

function requireTrustedReportBounds(context: TrustedOpenOracleReportContext, reports: ReadonlyMap<string, OracleGameSnapshot>, trustedReport: (report: OracleGameSnapshot) => boolean) {
	let signerReports = 0
	for (const report of reports.values()) {
		if (!trustedReport(report)) throw new Error(`OpenOracle report ${report.reportId} escaped its canonical trust boundary`)
		if (sameAddress(report.helper.creator, context.wallet)) signerReports += 1
	}
	if (signerReports > MAXIMUM_ACTIVE_SIGNER_REPORTS) {
		throw new Error(`Signer-owned unresolved OpenOracle reports exceed the durable limit of ${MAXIMUM_ACTIVE_SIGNER_REPORTS.toString()}`)
	}
	if (reports.size > context.coordinatorReports.length + MAXIMUM_ACTIVE_SIGNER_REPORTS) {
		throw new Error('Trusted unresolved OpenOracle report count exceeds its canonical source bound')
	}
}

function readUnsigned(bytes: Uint8Array, offset: number, width: number) {
	if (offset < 0 || width <= 0 || offset + width > bytes.length) throw new Error(`Packed log field ${offset}:${width} is out of bounds`)
	let value = 0n
	for (let index = offset; index < offset + width; index += 1) {
		const byte = bytes[index]
		if (byte === undefined) throw new Error('Packed log field is incomplete')
		value = (value << 8n) | BigInt(byte)
	}
	return value
}

function readAddress(bytes: Uint8Array, offset: number) {
	const slice = bytes.slice(offset, offset + 20)
	if (slice.length !== 20) throw new Error('Packed log address is incomplete')
	return getAddress(`0x${[...slice].map(byte => byte.toString(16).padStart(2, '0')).join('')}`)
}

function topicUnsigned(topic: Hash | undefined, label: string) {
	if (topic === undefined) throw new Error(`${label} topic is missing`)
	return BigInt(topic)
}

function topicAddress(topic: Hash | undefined, label: string) {
	if (topic === undefined) throw new Error(`${label} topic is missing`)
	return getAddress(`0x${topic.slice(-40)}`)
}

function strictTopicAddress(topic: Hash | undefined, label: string) {
	if (topic === undefined) throw new Error(`${label} topic is missing`)
	if (BigInt(topic) >> 160n !== 0n) throw new Error(`${label} topic has nonzero address padding`)
	return getAddress(`0x${topic.slice(-40)}`)
}

function strictTopicUnsigned(topic: Hash | undefined, bits: number, label: string) {
	const value = topicUnsigned(topic, label)
	if (value >= 1n << BigInt(bits)) throw new Error(`${label} topic exceeds uint${bits.toString()}`)
	return value
}

function abiWordAddress(bytes: Uint8Array, offset: number, label: string) {
	if (offset < 0 || offset + 32 > bytes.length) throw new Error(`${label} ABI word is incomplete`)
	if (readUnsigned(bytes, offset, 12) !== 0n) throw new Error(`${label} ABI word has nonzero address padding`)
	return readAddress(bytes, offset + 12)
}

export function deriveChildUniverseId(universeId: bigint, outcomeIndex: bigint) {
	if (universeId < 0n || universeId >= UINT248_LIMIT) throw new Error('Parent universe ID exceeds uint248')
	if (outcomeIndex < 0n || outcomeIndex >= 1n << 256n) throw new Error('Fork outcome exceeds uint256')
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [universeId, outcomeIndex]))) & (UINT248_LIMIT - 1n)
}

type CanonicalLogPosition = {
	address: Address
	blockHash?: Hash | null | undefined
	blockNumber?: bigint | null | undefined
	data: `0x${string}`
	logIndex?: bigint | number | null | undefined
	removed?: boolean | undefined
	topics: readonly Hash[]
	transactionHash?: Hash | null | undefined
	transactionIndex?: bigint | number | null | undefined
}

function canonicalLogOrdinal(value: bigint | number, label: string) {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`)
		return BigInt(value)
	}
	if (value < 0n) throw new Error(`${label} is invalid`)
	return value
}

function orderedCanonicalLogs<T extends CanonicalLogPosition>(logs: readonly T[], fromBlock: bigint, toBlock: bigint, label: string) {
	const identities = new Set<string>()
	const ordered = [...logs]
	for (const log of ordered) {
		if (log.removed) throw new Error(`${label} returned a removed canonical log`)
		if (log.blockHash == null || log.blockNumber == null || log.transactionHash == null || log.transactionIndex == null || log.logIndex == null) {
			throw new Error(`${label} returned a log without a canonical position`)
		}
		if (log.blockNumber < fromBlock || log.blockNumber > toBlock) throw new Error(`${label} returned a log outside the requested block range`)
		canonicalLogOrdinal(log.transactionIndex, `${label} transaction index`)
		canonicalLogOrdinal(log.logIndex, `${label} log index`)
		const identity = `${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${log.logIndex.toString()}`
		if (identities.has(identity)) throw new Error(`${label} returned duplicate log ${identity}`)
		identities.add(identity)
	}
	return ordered.sort((left, right) => {
		if (left.blockNumber == null || right.blockNumber == null || left.transactionIndex == null || right.transactionIndex == null || left.logIndex == null || right.logIndex == null) {
			throw new Error(`${label} lost a canonical log position`)
		}
		if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
		const leftTransactionIndex = canonicalLogOrdinal(left.transactionIndex, `${label} transaction index`)
		const rightTransactionIndex = canonicalLogOrdinal(right.transactionIndex, `${label} transaction index`)
		if (leftTransactionIndex !== rightTransactionIndex) return leftTransactionIndex < rightTransactionIndex ? -1 : 1
		const leftLogIndex = canonicalLogOrdinal(left.logIndex, `${label} log index`)
		const rightLogIndex = canonicalLogOrdinal(right.logIndex, `${label} log index`)
		if (leftLogIndex === rightLogIndex) return 0
		return leftLogIndex < rightLogIndex ? -1 : 1
	})
}

function signed256(value: bigint) {
	return value >= 1n << 255n ? value - (1n << 256n) : value
}

export function decodePackedOracleReport(reportId: bigint, openOracle: Address, packed: `0x${string}`): OracleGameSnapshot {
	const bytes = hexToBytes(packed)
	if (bytes.length !== 235) throw new Error(`OpenOracle report ${reportId.toString()} packed payload has ${bytes.length} bytes instead of 235`)
	const flags = bigintToSafeNumber(readUnsigned(bytes, 202, 1), 'OpenOracle flags')
	const reportTimestamp = readUnsigned(bytes, 52, 6)
	const settlementTime = readUnsigned(bytes, 90, 6)
	const disputeDelay = readUnsigned(bytes, 167, 3)
	const snapshot: OracleGameSnapshot = {
		currentAmount1: readUnsigned(bytes, 0, 16).toString(),
		currentAmount2: readUnsigned(bytes, 16, 16).toString(),
		currentReporter: readAddress(bytes, 32),
		disputeDelay: disputeDelay.toString(),
		escalationHalt: readUnsigned(bytes, 96, 16).toString(),
		flags,
		game: {
			callbackContract: readAddress(bytes, 175),
			callbackGasLimit: bigintToSafeNumber(readUnsigned(bytes, 195, 4), 'OpenOracle callback gas limit'),
			feePercentage: bigintToSafeNumber(readUnsigned(bytes, 170, 3), 'OpenOracle fee percentage'),
			lastReportOppoTime: readUnsigned(bytes, 84, 6).toString(),
			numReports: bigintToSafeNumber(readUnsigned(bytes, 164, 3), 'OpenOracle report count'),
			protocolFee: bigintToSafeNumber(readUnsigned(bytes, 199, 3), 'OpenOracle protocol fee'),
			protocolFeeRecipient: readAddress(bytes, 112),
			settlerReward: readUnsigned(bytes, 132, 12).toString(),
		},
		helper: {
			blockNumber: readUnsigned(bytes, 229, 6).toString(),
			blockTimestamp: readUnsigned(bytes, 223, 6).toString(),
			creator: readAddress(bytes, 203),
		},
		multiplier: bigintToSafeNumber(readUnsigned(bytes, 173, 2), 'OpenOracle multiplier'),
		openOracle,
		reportId: reportId.toString(),
		reportTimestamp: reportTimestamp.toString(),
		settlementTime: settlementTime.toString(),
		settlementTimestamp: readUnsigned(bytes, 58, 6).toString(),
		stateHash: zeroHash,
		token1: readAddress(bytes, 64),
		token2: readAddress(bytes, 144),
	}
	if ((flags & 1) !== 0) {
		snapshot.disputeAfterTimestamp = (reportTimestamp + disputeDelay).toString()
		snapshot.disputeBeforeTimestamp = (reportTimestamp + settlementTime).toString()
		snapshot.settleAfterTimestamp = (reportTimestamp + settlementTime).toString()
	}
	return snapshot
}

function validatePrevious(context: UpdateProtocolIndexContext, previous: ChaosProtocolIndex) {
	if (previous.schemaVersion !== 3) throw new Error(`Unsupported protocol index schema ${previous.schemaVersion}`)
	if (previous.chainId !== context.chainId) throw new Error('Protocol index chain does not match discovery chain')
	if (previous.openOracle.toLowerCase() !== context.openOracle.toLowerCase()) throw new Error('Protocol index OpenOracle deployment changed')
	if (previous.zoltar.toLowerCase() !== context.zoltar.toLowerCase()) throw new Error('Protocol index Zoltar deployment changed')
	if (previous.securityPoolForker.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('Protocol index SecurityPoolForker deployment changed')
	if (previous.wallet.toLowerCase() !== context.wallet.toLowerCase()) throw new Error('Protocol index wallet changed')
	if (previous.startBlock !== context.startBlock.toString()) throw new Error('Protocol index start block changed')
}

async function requireCanonicalBlock(client: IndexClient, blockNumber: bigint, expectedHash?: Hash) {
	const block = await client.getBlock({ blockNumber })
	if (block.number !== blockNumber || block.hash === null || block.hash === undefined) throw new Error(`RPC did not return canonical block ${blockNumber.toString()}`)
	if (expectedHash !== undefined && block.hash.toLowerCase() !== expectedHash.toLowerCase()) {
		throw new ChaosProtocolIndexReorgError(`Block ${blockNumber.toString()} changed from ${expectedHash} to ${block.hash}`, blockNumber)
	}
	return block.hash
}

function activeAuctionBids(source: Readonly<Record<string, readonly AuctionBidSnapshot[]>>) {
	const copy: Record<string, AuctionBidSnapshot[]> = {}
	for (const [address, bids] of Object.entries(source)) {
		const active = bids.filter(bid => !bid.refunded).map(bid => ({ ...bid }))
		if (active.length > 0) copy[address] = active
	}
	return copy
}

function activeAuctionRefunds(source: Readonly<Record<string, Readonly<AuctionRefundSnapshot>>>) {
	return Object.fromEntries(Object.entries(source).map(([address, refund]) => [address, { ...refund }]))
}

function refundEpisodeGeneration(log: CanonicalLogPosition) {
	if (log.blockHash == null || log.transactionHash == null || log.logIndex == null) throw new Error('Auction refund log has no canonical generation position')
	return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [log.blockHash, log.transactionHash, canonicalLogOrdinal(log.logIndex, 'Auction refund log index')]))
}

function activeEscalationDeposits(source: readonly EscalationDepositSnapshot[]) {
	return source.filter(deposit => !deposit.claimed).map(deposit => ({ ...deposit }))
}

function compareUnsignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

function sortedMigrationRepSplits(source: readonly MigrationRepSplitProgressSnapshot[]) {
	return source
		.map(progress => ({ ...progress }))
		.sort((left, right) => {
			const universeOrder = compareUnsignedStrings(left.universeId, right.universeId)
			if (universeOrder !== 0) return universeOrder
			return compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex)
		})
}

function sortedChildRepSplits(source: readonly ChildRepSplitProgressSnapshot[]) {
	return source
		.map(progress => ({ ...progress }))
		.sort((left, right) => {
			const poolOrder = left.pool.toLowerCase().localeCompare(right.pool.toLowerCase())
			return poolOrder === 0 ? compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex) : poolOrder
		})
}

function unsignedProgressValue(value: string, label: string, bits = 256) {
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an unsigned integer string`)
	const parsed = BigInt(value)
	if (parsed >= 1n << BigInt(bits)) throw new Error(`${label} exceeds uint${bits.toString()}`)
	return parsed
}

function migrationProgressKey(universeId: string, outcomeIndex: string) {
	return `${universeId}:${outcomeIndex}`
}

function childProgressKey(pool: Address, outcomeIndex: string) {
	return `${pool.toLowerCase()}:${outcomeIndex}`
}

function indexedMigrationProgress(source: readonly MigrationRepSplitProgressSnapshot[]) {
	const indexed = new Map<string, MigrationRepSplitProgressSnapshot>()
	for (const progress of source) {
		const universeId = unsignedProgressValue(progress.universeId, 'Migration progress universe ID', 248)
		const outcomeIndex = unsignedProgressValue(progress.outcomeIndex, 'Migration progress outcome index')
		const childUniverseId = unsignedProgressValue(progress.childUniverseId, 'Migration progress child universe ID', 248)
		unsignedProgressValue(progress.childMigrationRepAmountAttoRep, 'Migration progress cumulative REP')
		if (childUniverseId !== deriveChildUniverseId(universeId, outcomeIndex)) throw new Error('Persisted migration progress child universe ID does not match its parent/outcome derivation')
		const key = migrationProgressKey(progress.universeId, progress.outcomeIndex)
		if (indexed.has(key)) throw new Error(`Persisted migration progress contains duplicate route ${key}`)
		indexed.set(key, { ...progress })
	}
	return indexed
}

function indexedChildProgress(source: readonly ChildRepSplitProgressSnapshot[]) {
	const indexed = new Map<string, ChildRepSplitProgressSnapshot>()
	for (const progress of source) {
		const pool = getAddress(progress.pool)
		unsignedProgressValue(progress.outcomeIndex, 'Child-pool progress outcome index')
		unsignedProgressValue(progress.childPoolRepSplitAttoRep, 'Child-pool progress cumulative REP')
		const key = childProgressKey(pool, progress.outcomeIndex)
		if (indexed.has(key)) throw new Error(`Persisted child-pool progress contains duplicate route ${key}`)
		indexed.set(key, { ...progress, pool })
	}
	return indexed
}

export async function updateProtocolIndex(context: UpdateProtocolIndexContext): Promise<ProtocolIndexUpdate> {
	if (context.anchorBlockNumber < context.startBlock) throw new Error('Protocol index anchor precedes its start block')
	const trustedReport = trustedOpenOracleReportPredicate(context)
	const span = context.maxBlockSpan ?? 2_000n
	if (span <= 0n) throw new Error('Protocol index maxBlockSpan must be positive')
	const anchorHash = await requireCanonicalBlock(context.client, context.anchorBlockNumber, context.expectedAnchorHash)
	let fromBlock = context.startBlock
	const reports = new Map<string, OracleGameSnapshot>()
	let auctionBids: Record<string, AuctionBidSnapshot[]> = {}
	let auctionRefunds: Record<string, AuctionRefundSnapshot> = {}
	let escalationDeposits: EscalationDepositSnapshot[] = []
	let migrationRepSplits = new Map<string, MigrationRepSplitProgressSnapshot>()
	let childRepSplits = new Map<string, ChildRepSplitProgressSnapshot>()
	if (context.previous !== undefined) {
		validatePrevious(context, context.previous)
		const cursorNumber = BigInt(context.previous.cursor.blockNumber)
		if (cursorNumber > context.anchorBlockNumber) throw new ChaosProtocolIndexReorgError('Persisted protocol index cursor is ahead of the requested anchor', context.startBlock)
		await requireCanonicalBlock(context.client, cursorNumber, context.previous.cursor.blockHash)
		fromBlock = cursorNumber + 1n
		for (const report of context.previous.reports) {
			if (!trustedReport(report)) continue
			reports.set(report.reportId, { ...report, game: { ...report.game }, helper: { ...report.helper } })
		}
		requireTrustedReportBounds(context, reports, trustedReport)
		auctionBids = activeAuctionBids(context.previous.auctionBids)
		auctionRefunds = activeAuctionRefunds(context.previous.auctionRefunds)
		escalationDeposits = activeEscalationDeposits(context.previous.escalationDeposits)
		migrationRepSplits = indexedMigrationProgress(context.previous.migrationRepSplits)
		childRepSplits = indexedChildProgress(context.previous.childRepSplits)
	}
	if (fromBlock > context.anchorBlockNumber) {
		if (context.previous === undefined) throw new Error('Protocol index has no previous state at the requested anchor')
		requireTrustedReportBounds(context, reports, trustedReport)
		return {
			complete: true,
			fromBlock: fromBlock.toString(),
			index: {
				...context.previous,
				auctionBids,
				auctionRefunds,
				childRepSplits: sortedChildRepSplits([...childRepSplits.values()]),
				escalationDeposits,
				migrationRepSplits: sortedMigrationRepSplits([...migrationRepSplits.values()]),
				reports: [...reports.values()].sort((left, right) => (BigInt(left.reportId) < BigInt(right.reportId) ? -1 : 1)),
			},
			toBlock: context.previous.cursor.blockNumber,
		}
	}
	const maximumToBlock = fromBlock + span - 1n
	const toBlock = maximumToBlock < context.anchorBlockNumber ? maximumToBlock : context.anchorBlockNumber
	const oracleLogs = await context.client.getLogs({ address: context.openOracle, fromBlock, toBlock })
	for (const log of oracleLogs) {
		const topic0 = log.topics[0]
		if (topic0 !== REPORT_SUBMITTED && topic0 !== REPORT_DISPUTED && topic0 !== REPORT_SETTLED) continue
		const reportId = topicUnsigned(log.topics[1], 'OpenOracle report id')
		if (topic0 === REPORT_SUBMITTED || topic0 === REPORT_DISPUTED) {
			const decoded = decodePackedOracleReport(reportId, context.openOracle, log.data)
			if (trustedReport(decoded)) reports.set(reportId.toString(), decoded)
			else reports.delete(reportId.toString())
		} else if (topic0 === REPORT_SETTLED) reports.delete(reportId.toString())
	}
	requireTrustedReportBounds(context, reports, trustedReport)
	const migrationLogs = orderedCanonicalLogs(await context.client.getLogs({ address: [context.zoltar, context.securityPoolForker], fromBlock, toBlock }), fromBlock, toBlock, 'Migration progress index')
	for (const log of migrationLogs) {
		if (log.address.toLowerCase() !== context.zoltar.toLowerCase() && log.address.toLowerCase() !== context.securityPoolForker.toLowerCase()) {
			throw new Error(`Migration progress index returned unexpected emitter ${log.address}`)
		}
		const topic0 = log.topics[0]
		if (topic0 === MIGRATION_REP_SPLIT) {
			if (log.address.toLowerCase() !== context.zoltar.toLowerCase()) throw new Error('MigrationRepSplit was emitted outside canonical Zoltar')
			if (log.topics.length !== 4) throw new Error('MigrationRepSplit has an invalid indexed-field count')
			const migrator = strictTopicAddress(log.topics[1], 'MigrationRepSplit migrator')
			if (migrator.toLowerCase() !== context.wallet.toLowerCase()) continue
			const universeId = strictTopicUnsigned(log.topics[2], 248, 'MigrationRepSplit universe id')
			const childUniverseId = strictTopicUnsigned(log.topics[3], 248, 'MigrationRepSplit child universe id')
			const data = hexToBytes(log.data)
			if (data.length !== 128) throw new Error('MigrationRepSplit has an invalid data length')
			const recipient = abiWordAddress(data, 0, 'MigrationRepSplit recipient')
			if (recipient.toLowerCase() !== context.wallet.toLowerCase()) throw new Error('Wallet MigrationRepSplit recipient does not match the indexed wallet')
			const outcomeIndex = readUnsigned(data, 32, 32)
			const amountAttoRep = readUnsigned(data, 64, 32)
			const cumulativeAttoRep = readUnsigned(data, 96, 32)
			const expectedChildUniverseId = deriveChildUniverseId(universeId, outcomeIndex)
			if (childUniverseId !== expectedChildUniverseId) throw new Error('MigrationRepSplit child universe ID does not match its parent/outcome derivation')
			const routeKey = migrationProgressKey(universeId.toString(), outcomeIndex.toString())
			const existing = migrationRepSplits.get(routeKey)
			const previousCumulative = existing === undefined ? 0n : BigInt(existing.childMigrationRepAmountAttoRep)
			if (cumulativeAttoRep !== previousCumulative + amountAttoRep) {
				throw new Error(`MigrationRepSplit cumulative progress is discontinuous for universe ${universeId.toString()} outcome ${outcomeIndex.toString()}`)
			}
			const progress: MigrationRepSplitProgressSnapshot = {
				childMigrationRepAmountAttoRep: cumulativeAttoRep.toString(),
				childUniverseId: childUniverseId.toString(),
				outcomeIndex: outcomeIndex.toString(),
				universeId: universeId.toString(),
			}
			if (existing !== undefined && existing.childUniverseId !== progress.childUniverseId) throw new Error('MigrationRepSplit route changed its derived child universe ID')
			migrationRepSplits.set(routeKey, progress)
		} else if (topic0 === CHILD_REP_SPLIT) {
			if (log.address.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('ChildRepSplit was emitted outside canonical SecurityPoolForker')
			if (log.topics.length !== 3) throw new Error('ChildRepSplit has an invalid indexed-field count')
			const pool = strictTopicAddress(log.topics[1], 'ChildRepSplit parent')
			const outcomeIndex = topicUnsigned(log.topics[2], 'ChildRepSplit outcome index')
			const data = hexToBytes(log.data)
			if (data.length !== 64) throw new Error('ChildRepSplit has an invalid data length')
			const cumulativeAttoRep = readUnsigned(data, 0, 32)
			readUnsigned(data, 32, 32)
			const routeKey = childProgressKey(pool, outcomeIndex.toString())
			const existing = childRepSplits.get(routeKey)
			const previousCumulative = existing === undefined ? 0n : BigInt(existing.childPoolRepSplitAttoRep)
			if (cumulativeAttoRep <= previousCumulative) {
				throw new Error(`ChildRepSplit cumulative progress did not increase for pool ${pool} outcome ${outcomeIndex.toString()}`)
			}
			const progress: ChildRepSplitProgressSnapshot = {
				childPoolRepSplitAttoRep: cumulativeAttoRep.toString(),
				outcomeIndex: outcomeIndex.toString(),
				pool,
			}
			childRepSplits.set(routeKey, progress)
		}
	}
	if (context.auctionAddresses.length > 0) {
		const auctionAddressKeys = new Set(context.auctionAddresses.map(address => address.toLowerCase()))
		const auctionLogs = orderedCanonicalLogs(await context.client.getLogs({ address: [...context.auctionAddresses], fromBlock, toBlock }), fromBlock, toBlock, 'Auction event index')
		for (const log of auctionLogs) {
			const key = log.address.toLowerCase()
			if (!auctionAddressKeys.has(key)) throw new Error(`Auction event index returned unexpected emitter ${log.address}`)
			const topic0 = log.topics[0]
			if (topic0 === ETH_REFUND_DEFERRED || topic0 === PENDING_ETH_REFUND_WITHDRAWN) {
				if (log.topics.length !== 2) throw new Error('Auction refund event has an invalid indexed-field count')
				const bidder = strictTopicAddress(log.topics[1], 'Auction refund bidder')
				if (bidder.toLowerCase() !== context.wallet.toLowerCase()) continue
				const data = hexToBytes(log.data)
				if (topic0 === ETH_REFUND_DEFERRED) {
					if (data.length !== 64) throw new Error('EthRefundDeferred has an invalid data length')
					const amountAttoEth = readUnsigned(data, 0, 32)
					const pendingAttoEth = readUnsigned(data, 32, 32)
					if (amountAttoEth === 0n || pendingAttoEth === 0n) throw new Error('EthRefundDeferred has a zero refund amount')
					const existing = auctionRefunds[key]
					if (existing === undefined) {
						if (pendingAttoEth !== amountAttoEth) {
							throw new Error(`EthRefundDeferred for auction ${log.address} did not start from zero; protocolStartBlock is after the episode start or the event history is incomplete`)
						}
						auctionRefunds[key] = { generation: refundEpisodeGeneration(log), pendingAttoEth: pendingAttoEth.toString() }
					} else {
						const expectedPendingAttoEth = BigInt(existing.pendingAttoEth) + amountAttoEth
						if (pendingAttoEth !== expectedPendingAttoEth) throw new Error(`EthRefundDeferred continuity failed for auction ${log.address}`)
						auctionRefunds[key] = { ...existing, pendingAttoEth: pendingAttoEth.toString() }
					}
				} else {
					if (data.length !== 32) throw new Error('PendingEthRefundWithdrawn has an invalid data length')
					const amountAttoEth = readUnsigned(data, 0, 32)
					const existing = auctionRefunds[key]
					if (existing === undefined) throw new Error(`PendingEthRefundWithdrawn for auction ${log.address} has no authenticated active refund episode`)
					if (amountAttoEth === 0n || amountAttoEth !== BigInt(existing.pendingAttoEth)) throw new Error(`PendingEthRefundWithdrawn amount does not match the active refund episode for auction ${log.address}`)
					delete auctionRefunds[key]
				}
				continue
			}
			if (topic0 !== BID_SUBMITTED && topic0 !== BID_SETTLED) continue
			const bidder = topicAddress(log.topics[1], 'Auction bidder')
			if (bidder.toLowerCase() !== context.wallet.toLowerCase()) continue
			const tick = signed256(topicUnsigned(log.topics[2], 'Auction tick')).toString()
			const index = topicUnsigned(log.topics[3], 'Auction bid index').toString()
			const bids = auctionBids[key] ?? []
			const existing = bids.find(bid => bid.tick === tick && bid.index === index)
			if (topic0 === BID_SUBMITTED) {
				const bid: AuctionBidSnapshot = { amountAttoEth: readUnsigned(hexToBytes(log.data), 0, 32).toString(), index, refunded: false, tick }
				if (existing === undefined) bids.push(bid)
				else Object.assign(existing, bid)
			} else if (existing !== undefined) existing.refunded = true
			auctionBids[key] = bids
		}
	}
	if (context.escalationGames.length > 0) {
		const routeByGame = new Map(context.escalationGames.map(route => [route.escalationGame.toLowerCase(), route]))
		const escalationLogs = await context.client.getLogs({ address: context.escalationGames.map(route => route.escalationGame), fromBlock, toBlock })
		const pendingLocal: Array<{ game: Address; pool: Address; vault: Address; outcome: number; amountAttoRep: CanonicalUintString; parentDepositIndex: string; cumulative: string }> = []
		for (const log of escalationLogs) {
			const topic0 = log.topics[0]
			const route = routeByGame.get(log.address.toLowerCase())
			if (route === undefined) throw new Error(`Indexed escalation game ${log.address} has no pool route`)
			if (topic0 === LOCAL_DEPOSIT_APPENDED) {
				const data = hexToBytes(log.data)
				pendingLocal.push({
					amountAttoRep: readUnsigned(data, 0, 32).toString(),
					cumulative: readUnsigned(data, 64, 32).toString(),
					game: route.escalationGame,
					outcome: bigintToSafeNumber(topicUnsigned(log.topics[2], 'Escalation outcome'), 'Escalation outcome'),
					parentDepositIndex: readUnsigned(data, 32, 32).toString(),
					pool: route.pool,
					vault: topicAddress(log.topics[3], 'Escalation depositor'),
				})
			} else if (topic0 === DEPOSIT_ON_OUTCOME) {
				const data = hexToBytes(log.data)
				const vault = topicAddress(log.topics[1], 'Escalation depositor')
				const outcome = bigintToSafeNumber(topicUnsigned(log.topics[2], 'Escalation outcome'), 'Escalation outcome')
				const amountAttoRep = readUnsigned(data, 0, 32).toString()
				const cumulative = readUnsigned(data, 64, 32).toString()
				const pendingIndex = pendingLocal.findIndex(candidate => candidate.game.toLowerCase() === route.escalationGame.toLowerCase() && candidate.vault.toLowerCase() === vault.toLowerCase() && candidate.outcome === outcome && candidate.amountAttoRep === amountAttoRep && candidate.cumulative === cumulative)
				const local = pendingIndex < 0 ? undefined : pendingLocal.splice(pendingIndex, 1)[0]
				if (local === undefined) throw new Error(`DepositOnOutcome for ${vault} has no matching LocalDepositAppended event`)
				const depositIndex = readUnsigned(data, 32, 32).toString()
				const existing = escalationDeposits.find(deposit => deposit.escalationGame.toLowerCase() === route.escalationGame.toLowerCase() && deposit.outcome === outcome && deposit.depositIndex === depositIndex)
				const deposit: EscalationDepositSnapshot = { amountAttoRep, claimed: false, depositIndex, escalationGame: route.escalationGame, outcome, parentDepositIndex: local.parentDepositIndex, pool: route.pool, vault }
				if (existing === undefined) escalationDeposits.push(deposit)
				else Object.assign(existing, deposit)
			} else if (topic0 === CLAIM_DEPOSIT) {
				const vault = topicAddress(log.topics[1], 'Escalation claimant')
				const outcome = bigintToSafeNumber(topicUnsigned(log.topics[2], 'Escalation outcome'), 'Escalation outcome')
				const parentDepositIndex = topicUnsigned(log.topics[3], 'Parent deposit index').toString()
				const deposit = escalationDeposits.find(candidate => candidate.escalationGame.toLowerCase() === route.escalationGame.toLowerCase() && candidate.vault.toLowerCase() === vault.toLowerCase() && candidate.outcome === outcome && candidate.parentDepositIndex === parentDepositIndex)
				if (deposit !== undefined) deposit.claimed = true
			} else if (topic0 === CARRY_DEPOSIT_CONSUMED) {
				const parentDepositIndex = topicUnsigned(log.topics[1], 'Consumed parent deposit index').toString()
				const vault = topicAddress(log.topics[3], 'Consumed escalation depositor')
				const outcome = bigintToSafeNumber(readUnsigned(hexToBytes(log.data), 0, 32), 'Consumed escalation outcome')
				const deposit = escalationDeposits.find(candidate => candidate.escalationGame.toLowerCase() === route.escalationGame.toLowerCase() && candidate.vault.toLowerCase() === vault.toLowerCase() && candidate.outcome === outcome && candidate.parentDepositIndex === parentDepositIndex)
				if (deposit !== undefined) deposit.claimed = true
			}
		}
		if (pendingLocal.length > 0) throw new Error('Escalation log range ended with unmatched local deposit events')
	}
	for (const [reportId, report] of reports) {
		const stateHash = await context.client.readContract({ abi: openOracleAbi, address: context.openOracle, args: [BigInt(reportId)], blockNumber: toBlock, functionName: 'oracleGame' })
		reports.set(reportId, { ...report, stateHash })
	}
	requireTrustedReportBounds(context, reports, trustedReport)
	const cursorHash = toBlock === context.anchorBlockNumber ? anchorHash : await requireCanonicalBlock(context.client, toBlock)
	const index: ChaosProtocolIndex = {
		auctionBids: activeAuctionBids(auctionBids),
		auctionRefunds: activeAuctionRefunds(auctionRefunds),
		chainId: context.chainId,
		childRepSplits: sortedChildRepSplits([...childRepSplits.values()]),
		cursor: { blockHash: cursorHash, blockNumber: toBlock.toString() },
		escalationDeposits: activeEscalationDeposits(escalationDeposits),
		migrationRepSplits: sortedMigrationRepSplits([...migrationRepSplits.values()]),
		openOracle: context.openOracle,
		reports: [...reports.values()].sort((left, right) => (BigInt(left.reportId) < BigInt(right.reportId) ? -1 : 1)),
		schemaVersion: 3,
		securityPoolForker: context.securityPoolForker,
		startBlock: context.startBlock.toString(),
		wallet: context.wallet,
		zoltar: context.zoltar,
	}
	return { complete: toBlock === context.anchorBlockNumber, fromBlock: fromBlock.toString(), index, toBlock: toBlock.toString() }
}

export function protocolIndexDiscoveryInputs(index: ChaosProtocolIndex) {
	return {
		indexedAuctionBids: index.auctionBids,
		indexedAuctionRefunds: index.auctionRefunds,
		indexedChildRepSplits: index.childRepSplits,
		indexedEscalationDeposits: index.escalationDeposits,
		indexedMigrationRepSplits: index.migrationRepSplits,
		indexedReports: index.reports,
	}
}
