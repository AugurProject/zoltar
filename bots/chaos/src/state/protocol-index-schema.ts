import { encodeAbiParameters, getAddress, keccak256, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '#monitoring/protocol-index'
import type { AuctionBidSnapshot, AuctionRefundSnapshot, ChildRepSplitProgressSnapshot, EscalationDepositSnapshot, MigrationRepSplitProgressSnapshot, OracleGameSnapshot } from '#operations/types'
import { compareUnsignedStrings } from '../core/units.ts'
import { assertExactKeys, nonemptyString, normalizedHash32 as hash, requiredRecord, unsignedIntegerString } from './validators.ts'

export const MAXIMUM_PROTOCOL_INDEX_RECORDS = 100_000
const validatedProtocolIndexes = new WeakSet<ChaosProtocolIndex>()

export function isValidatedProtocolIndex(index: ChaosProtocolIndex) {
	return validatedProtocolIndexes.has(index)
}

export type ProtocolIndexIdentity = {
	chainId: number
	cursor: { blockHash: Hash; blockNumber: string }
	openOracle: Address
	schemaVersion: 3
	securityPoolForker: Address
	startBlock: string
	availableStartBlock?: string
	wallet: Address
	zoltar: Address
}

export type AuctionBidRecord = {
	auction: Address
	bid: AuctionBidSnapshot
}

export type AuctionRefundRecord = {
	auction: Address
	refund: AuctionRefundSnapshot
}

function signedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an integer string`)
	return value
}

function boundedInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be an integer between 0 and ${maximum.toString()}`)
	return value
}

function boundedUnsignedString(value: unknown, label: string, bits: number) {
	const parsed = unsignedIntegerString(value, label)
	const maximumDigits = Math.ceil(bits * Math.log10(2))
	if (parsed.length > maximumDigits) throw new Error(`${label} exceeds uint${bits.toString()}`)
	if (BigInt(parsed) >= 1n << BigInt(bits)) throw new Error(`${label} exceeds uint${bits.toString()}`)
	return parsed
}

function compareSignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

export function parseIdentity(value: unknown, expectedChainId: number, label = 'protocolIndex'): ProtocolIndexIdentity {
	const index = requiredRecord(value, label)
	assertExactKeys(index, ['chainId', 'cursor', 'openOracle', 'schemaVersion', 'securityPoolForker', 'startBlock', 'wallet', 'zoltar'], ['availableStartBlock'], label)
	if (index['schemaVersion'] !== 3) throw new Error(`${label}.schemaVersion is unsupported`)
	if (index['chainId'] !== expectedChainId) throw new Error(`Protocol index belongs to chain ${String(index['chainId'])}, expected chain ${expectedChainId.toString()}`)
	const startBlock = boundedUnsignedString(index['startBlock'], `${label}.startBlock`, 256)
	const cursor = requiredRecord(index['cursor'], `${label}.cursor`)
	assertExactKeys(cursor, ['blockHash', 'blockNumber'], [], `${label}.cursor`)
	const cursorBlockNumber = boundedUnsignedString(cursor['blockNumber'], `${label}.cursor.blockNumber`, 256)
	if (BigInt(cursorBlockNumber) < BigInt(startBlock)) throw new Error(`${label}.cursor.blockNumber precedes ${label}.startBlock`)
	const availableStartBlock = index['availableStartBlock'] === undefined ? undefined : boundedUnsignedString(index['availableStartBlock'], `${label}.availableStartBlock`, 256)
	if (availableStartBlock !== undefined && (BigInt(availableStartBlock) <= BigInt(startBlock) || BigInt(availableStartBlock) > BigInt(cursorBlockNumber))) throw new Error(`${label}.availableStartBlock must follow startBlock and not exceed the cursor`)
	return {
		chainId: expectedChainId,
		cursor: { blockHash: hash(cursor['blockHash'], `${label}.cursor.blockHash`), blockNumber: cursorBlockNumber },
		openOracle: getAddress(nonemptyString(index['openOracle'], `${label}.openOracle`)),
		schemaVersion: 3,
		securityPoolForker: getAddress(nonemptyString(index['securityPoolForker'], `${label}.securityPoolForker`)),
		startBlock,
		...(availableStartBlock === undefined ? {} : { availableStartBlock }),
		wallet: getAddress(nonemptyString(index['wallet'], `${label}.wallet`)),
		zoltar: getAddress(nonemptyString(index['zoltar'], `${label}.zoltar`)),
	}
}

export function parseOracleGame(value: unknown, label: string, expectedOpenOracle: Address, cursorBlockNumber: bigint): OracleGameSnapshot {
	const report = requiredRecord(value, label)
	assertExactKeys(
		report,
		['currentAmount1', 'currentAmount2', 'currentReporter', 'disputeDelay', 'escalationHalt', 'flags', 'game', 'helper', 'multiplier', 'openOracle', 'reportId', 'reportTimestamp', 'settlementTime', 'settlementTimestamp', 'stateHash', 'token1', 'token2'],
		['disputeAfterTimestamp', 'disputeBeforeTimestamp', 'settleAfterTimestamp'],
		label,
	)
	const gameLabel = `${label}.game`
	const game = requiredRecord(report['game'], gameLabel)
	assertExactKeys(game, ['callbackContract', 'callbackGasLimit', 'feePercentage', 'lastReportOppoTime', 'numReports', 'protocolFee', 'protocolFeeRecipient', 'settlerReward'], [], gameLabel)
	const helperLabel = `${label}.helper`
	const helper = requiredRecord(report['helper'], helperLabel)
	assertExactKeys(helper, ['blockNumber', 'blockTimestamp', 'creator'], [], helperLabel)
	const helperBlockNumber = boundedUnsignedString(helper['blockNumber'], `${helperLabel}.blockNumber`, 48)
	if (BigInt(helperBlockNumber) > cursorBlockNumber) throw new Error(`${helperLabel}.blockNumber is ahead of the protocol index cursor`)
	const openOracle = getAddress(nonemptyString(report['openOracle'], `${label}.openOracle`))
	if (openOracle.toLowerCase() !== expectedOpenOracle.toLowerCase()) throw new Error(`${label}.openOracle does not match protocolIndex.openOracle`)
	const disputeAfterTimestamp = report['disputeAfterTimestamp'] === undefined ? undefined : boundedUnsignedString(report['disputeAfterTimestamp'], `${label}.disputeAfterTimestamp`, 256)
	const disputeBeforeTimestamp = report['disputeBeforeTimestamp'] === undefined ? undefined : boundedUnsignedString(report['disputeBeforeTimestamp'], `${label}.disputeBeforeTimestamp`, 256)
	const settleAfterTimestamp = report['settleAfterTimestamp'] === undefined ? undefined : boundedUnsignedString(report['settleAfterTimestamp'], `${label}.settleAfterTimestamp`, 256)
	return {
		currentAmount1: boundedUnsignedString(report['currentAmount1'], `${label}.currentAmount1`, 128),
		currentAmount2: boundedUnsignedString(report['currentAmount2'], `${label}.currentAmount2`, 128),
		currentReporter: getAddress(nonemptyString(report['currentReporter'], `${label}.currentReporter`)),
		disputeDelay: boundedUnsignedString(report['disputeDelay'], `${label}.disputeDelay`, 24),
		...(disputeAfterTimestamp === undefined ? {} : { disputeAfterTimestamp }),
		...(disputeBeforeTimestamp === undefined ? {} : { disputeBeforeTimestamp }),
		escalationHalt: boundedUnsignedString(report['escalationHalt'], `${label}.escalationHalt`, 128),
		flags: boundedInteger(report['flags'], `${label}.flags`, 0xff),
		game: {
			callbackContract: getAddress(nonemptyString(game['callbackContract'], `${gameLabel}.callbackContract`)),
			callbackGasLimit: boundedInteger(game['callbackGasLimit'], `${gameLabel}.callbackGasLimit`, 0xffff_ffff),
			feePercentage: boundedInteger(game['feePercentage'], `${gameLabel}.feePercentage`, 0xff_ffff),
			lastReportOppoTime: boundedUnsignedString(game['lastReportOppoTime'], `${gameLabel}.lastReportOppoTime`, 48),
			numReports: boundedInteger(game['numReports'], `${gameLabel}.numReports`, 0xff_ffff),
			protocolFee: boundedInteger(game['protocolFee'], `${gameLabel}.protocolFee`, 0xff_ffff),
			protocolFeeRecipient: getAddress(nonemptyString(game['protocolFeeRecipient'], `${gameLabel}.protocolFeeRecipient`)),
			settlerReward: boundedUnsignedString(game['settlerReward'], `${gameLabel}.settlerReward`, 96),
		},
		helper: {
			blockNumber: helperBlockNumber,
			blockTimestamp: boundedUnsignedString(helper['blockTimestamp'], `${helperLabel}.blockTimestamp`, 48),
			creator: getAddress(nonemptyString(helper['creator'], `${helperLabel}.creator`)),
		},
		multiplier: boundedInteger(report['multiplier'], `${label}.multiplier`, 0xffff),
		openOracle,
		reportId: boundedUnsignedString(report['reportId'], `${label}.reportId`, 256),
		reportTimestamp: boundedUnsignedString(report['reportTimestamp'], `${label}.reportTimestamp`, 48),
		...(settleAfterTimestamp === undefined ? {} : { settleAfterTimestamp }),
		settlementTime: boundedUnsignedString(report['settlementTime'], `${label}.settlementTime`, 48),
		settlementTimestamp: boundedUnsignedString(report['settlementTimestamp'], `${label}.settlementTimestamp`, 48),
		stateHash: hash(report['stateHash'], `${label}.stateHash`),
		token1: getAddress(nonemptyString(report['token1'], `${label}.token1`)),
		token2: getAddress(nonemptyString(report['token2'], `${label}.token2`)),
	}
}

function parseAuctionBid(value: unknown, label: string): AuctionBidSnapshot {
	const bid = requiredRecord(value, label)
	assertExactKeys(bid, ['amountAttoEth', 'index', 'refunded', 'tick'], [], label)
	if (typeof bid['refunded'] !== 'boolean') throw new Error(`${label}.refunded must be a boolean`)
	const tick = signedIntegerString(bid['tick'], `${label}.tick`)
	if ((tick.startsWith('-') ? tick.length - 1 : tick.length) > 78) throw new Error(`${label}.tick is outside the int256 range`)
	const parsedTick = BigInt(tick)
	if (parsedTick < -(1n << 255n) || parsedTick >= 1n << 255n) throw new Error(`${label}.tick is outside the int256 range`)
	return {
		amountAttoEth: boundedUnsignedString(bid['amountAttoEth'], `${label}.amountAttoEth`, 256),
		index: boundedUnsignedString(bid['index'], `${label}.index`, 256),
		refunded: bid['refunded'],
		tick,
	}
}

export function parseAuctionBidRecord(value: unknown, label: string): AuctionBidRecord {
	const record = requiredRecord(value, label)
	assertExactKeys(record, ['auction', 'bid'], [], label)
	return {
		auction: getAddress(nonemptyString(record['auction'], `${label}.auction`)),
		bid: parseAuctionBid(record['bid'], `${label}.bid`),
	}
}

function parseAuctionRefund(value: unknown, label: string): AuctionRefundSnapshot {
	const refund = requiredRecord(value, label)
	assertExactKeys(refund, ['generation', 'pendingAttoEth'], [], label)
	const pendingAttoEth = boundedUnsignedString(refund['pendingAttoEth'], `${label}.pendingAttoEth`, 256)
	if (pendingAttoEth === '0') throw new Error(`${label}.pendingAttoEth must be positive`)
	return {
		generation: hash(refund['generation'], `${label}.generation`),
		pendingAttoEth,
	}
}

export function parseAuctionRefundRecord(value: unknown, label: string): AuctionRefundRecord {
	const record = requiredRecord(value, label)
	assertExactKeys(record, ['auction', 'refund'], [], label)
	return {
		auction: getAddress(nonemptyString(record['auction'], `${label}.auction`)),
		refund: parseAuctionRefund(record['refund'], `${label}.refund`),
	}
}

export function parseEscalationDeposit(value: unknown, label: string): EscalationDepositSnapshot {
	const deposit = requiredRecord(value, label)
	assertExactKeys(deposit, ['amountAttoRep', 'claimed', 'depositIndex', 'escalationGame', 'outcome', 'parentDepositIndex', 'pool', 'vault'], [], label)
	if (typeof deposit['claimed'] !== 'boolean') throw new Error(`${label}.claimed must be a boolean`)
	return {
		amountAttoRep: boundedUnsignedString(deposit['amountAttoRep'], `${label}.amountAttoRep`, 256),
		claimed: deposit['claimed'],
		depositIndex: boundedUnsignedString(deposit['depositIndex'], `${label}.depositIndex`, 256),
		escalationGame: getAddress(nonemptyString(deposit['escalationGame'], `${label}.escalationGame`)),
		outcome: boundedInteger(deposit['outcome'], `${label}.outcome`, 2),
		parentDepositIndex: boundedUnsignedString(deposit['parentDepositIndex'], `${label}.parentDepositIndex`, 256),
		pool: getAddress(nonemptyString(deposit['pool'], `${label}.pool`)),
		vault: getAddress(nonemptyString(deposit['vault'], `${label}.vault`)),
	}
}

function derivedChildUniverseId(universeId: string, outcomeIndex: string) {
	return (BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [BigInt(universeId), BigInt(outcomeIndex)]))) & ((1n << 248n) - 1n)).toString()
}

export function parseMigrationRepSplitProgress(value: unknown, label: string): MigrationRepSplitProgressSnapshot {
	const progress = requiredRecord(value, label)
	assertExactKeys(progress, ['childMigrationRepAmountAttoRep', 'childUniverseId', 'outcomeIndex', 'universeId'], [], label)
	const universeId = boundedUnsignedString(progress['universeId'], `${label}.universeId`, 248)
	const outcomeIndex = boundedUnsignedString(progress['outcomeIndex'], `${label}.outcomeIndex`, 256)
	const childUniverseId = boundedUnsignedString(progress['childUniverseId'], `${label}.childUniverseId`, 248)
	if (childUniverseId !== derivedChildUniverseId(universeId, outcomeIndex)) throw new Error(`${label}.childUniverseId does not match its parent/outcome derivation`)
	return {
		childMigrationRepAmountAttoRep: boundedUnsignedString(progress['childMigrationRepAmountAttoRep'], `${label}.childMigrationRepAmountAttoRep`, 256),
		childUniverseId,
		outcomeIndex,
		universeId,
	}
}

export function parseChildRepSplitProgress(value: unknown, label: string): ChildRepSplitProgressSnapshot {
	const progress = requiredRecord(value, label)
	assertExactKeys(progress, ['childPoolRepSplitAttoRep', 'outcomeIndex', 'pool'], [], label)
	const childPoolRepSplitAttoRep = boundedUnsignedString(progress['childPoolRepSplitAttoRep'], `${label}.childPoolRepSplitAttoRep`, 256)
	if (childPoolRepSplitAttoRep === '0') throw new Error(`${label}.childPoolRepSplitAttoRep must be positive`)
	return {
		childPoolRepSplitAttoRep,
		outcomeIndex: boundedUnsignedString(progress['outcomeIndex'], `${label}.outcomeIndex`, 256),
		pool: getAddress(nonemptyString(progress['pool'], `${label}.pool`)),
	}
}

export function compareReports(left: OracleGameSnapshot, right: OracleGameSnapshot) {
	return compareUnsignedStrings(left.reportId, right.reportId)
}

export function compareAuctionBidRecords(left: AuctionBidRecord, right: AuctionBidRecord) {
	const auctionOrder = left.auction.toLowerCase().localeCompare(right.auction.toLowerCase())
	if (auctionOrder !== 0) return auctionOrder
	const tickOrder = compareSignedStrings(left.bid.tick, right.bid.tick)
	return tickOrder === 0 ? compareUnsignedStrings(left.bid.index, right.bid.index) : tickOrder
}

export function compareAuctionRefundRecords(left: AuctionRefundRecord, right: AuctionRefundRecord) {
	return left.auction.toLowerCase().localeCompare(right.auction.toLowerCase())
}

export function compareDeposits(left: EscalationDepositSnapshot, right: EscalationDepositSnapshot) {
	const gameOrder = left.escalationGame.toLowerCase().localeCompare(right.escalationGame.toLowerCase())
	if (gameOrder !== 0) return gameOrder
	if (left.outcome !== right.outcome) return left.outcome < right.outcome ? -1 : 1
	return compareUnsignedStrings(left.depositIndex, right.depositIndex)
}

export function compareMigrationRoutes(left: MigrationRepSplitProgressSnapshot, right: MigrationRepSplitProgressSnapshot) {
	const universeOrder = compareUnsignedStrings(left.universeId, right.universeId)
	return universeOrder === 0 ? compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex) : universeOrder
}

export function compareChildRoutes(left: ChildRepSplitProgressSnapshot, right: ChildRepSplitProgressSnapshot) {
	const poolOrder = left.pool.toLowerCase().localeCompare(right.pool.toLowerCase())
	return poolOrder === 0 ? compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex) : poolOrder
}

export function assertStrictCanonicalOrder<T>(values: readonly T[], compare: (left: T, right: T) => number, label: string) {
	for (let index = 1; index < values.length; index += 1) {
		const previous = values[index - 1]
		const current = values[index]
		if (previous === undefined || current === undefined || compare(previous, current) >= 0) throw new Error(`${label} is not in canonical unique route order`)
	}
}

function parsedAuctionBidRecords(value: unknown, label: string) {
	const auctionBidRecord = requiredRecord(value, label)
	const flattened: AuctionBidRecord[] = []
	for (const [key, valueAtKey] of Object.entries(auctionBidRecord)) {
		const auction = getAddress(key)
		if (key !== key.toLowerCase()) throw new Error(`${label} key ${key} must be lowercase`)
		if (!Array.isArray(valueAtKey)) throw new Error(`${label}.${key} must be an array`)
		for (let index = 0; index < valueAtKey.length; index += 1) {
			flattened.push({ auction, bid: parseAuctionBid(valueAtKey[index], `${label}.${key}[${index.toString()}]`) })
		}
	}
	flattened.sort(compareAuctionBidRecords)
	assertStrictCanonicalOrder(flattened, compareAuctionBidRecords, label)
	return flattened
}

export function auctionBidRecord(records: readonly AuctionBidRecord[]) {
	const result: Record<string, AuctionBidSnapshot[]> = {}
	for (const record of records) {
		const key = record.auction.toLowerCase()
		const bids = result[key] ?? []
		bids.push(record.bid)
		result[key] = bids
	}
	return result
}

function parsedAuctionRefundRecords(value: unknown, label: string) {
	const auctionRefundRecord = requiredRecord(value, label)
	const flattened = Object.entries(auctionRefundRecord).map(([key, refund]) => {
		const auction = getAddress(key)
		if (key !== key.toLowerCase()) throw new Error(`${label} key ${key} must be lowercase`)
		return { auction, refund: parseAuctionRefund(refund, `${label}.${key}`) }
	})
	flattened.sort(compareAuctionRefundRecords)
	assertStrictCanonicalOrder(flattened, compareAuctionRefundRecords, label)
	return flattened
}

export function auctionRefundRecord(records: readonly AuctionRefundRecord[]) {
	return Object.fromEntries(records.map(record => [record.auction.toLowerCase(), record.refund]))
}

function assertProtocolIndexRecordEnvelope(index: Record<string, unknown>) {
	const arrays = ['childRepSplits', 'escalationDeposits', 'migrationRepSplits', 'reports'] as const
	let recordCount = 0
	for (const key of arrays) {
		const records = index[key]
		if (!Array.isArray(records)) throw new Error(`protocolIndex.${key} must be an array`)
		recordCount += records.length
	}
	const auctionBids = requiredRecord(index['auctionBids'], 'protocolIndex.auctionBids')
	for (const [key, bids] of Object.entries(auctionBids)) {
		if (!Array.isArray(bids)) throw new Error(`protocolIndex.auctionBids.${key} must be an array`)
		recordCount += bids.length
	}
	recordCount += Object.keys(requiredRecord(index['auctionRefunds'], 'protocolIndex.auctionRefunds')).length
	if (recordCount > MAXIMUM_PROTOCOL_INDEX_RECORDS) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_RECORDS.toString()}-record aggregate safety limit`)
}

export function parseProtocolIndex(value: unknown, expectedChainId: number): ChaosProtocolIndex | undefined {
	if (value === null || value === undefined) return undefined
	const index = requiredRecord(value, 'protocolIndex')
	assertExactKeys(index, ['auctionBids', 'auctionRefunds', 'chainId', 'childRepSplits', 'cursor', 'escalationDeposits', 'migrationRepSplits', 'openOracle', 'reports', 'schemaVersion', 'securityPoolForker', 'startBlock', 'wallet', 'zoltar'], ['availableStartBlock'], 'protocolIndex')
	assertProtocolIndexRecordEnvelope(index)
	const identity = parseIdentity(
		{
			chainId: index['chainId'],
			cursor: index['cursor'],
			openOracle: index['openOracle'],
			schemaVersion: index['schemaVersion'],
			securityPoolForker: index['securityPoolForker'],
			startBlock: index['startBlock'],
			...(index['availableStartBlock'] === undefined ? {} : { availableStartBlock: index['availableStartBlock'] }),
			wallet: index['wallet'],
			zoltar: index['zoltar'],
		},
		expectedChainId,
	)
	if (!Array.isArray(index['reports'])) throw new Error('protocolIndex.reports must be an array')
	const reports = index['reports'].map((report, reportIndex) => parseOracleGame(report, `protocolIndex.reports[${reportIndex.toString()}]`, identity.openOracle, BigInt(identity.cursor.blockNumber)))
	reports.sort(compareReports)
	assertStrictCanonicalOrder(reports, compareReports, 'protocolIndex.reports')
	const bids = parsedAuctionBidRecords(index['auctionBids'], 'protocolIndex.auctionBids')
	const refunds = parsedAuctionRefundRecords(index['auctionRefunds'], 'protocolIndex.auctionRefunds')
	if (!Array.isArray(index['escalationDeposits'])) throw new Error('protocolIndex.escalationDeposits must be an array')
	const escalationDeposits = index['escalationDeposits'].map((deposit, depositIndex) => parseEscalationDeposit(deposit, `protocolIndex.escalationDeposits[${depositIndex.toString()}]`))
	escalationDeposits.sort(compareDeposits)
	assertStrictCanonicalOrder(escalationDeposits, compareDeposits, 'protocolIndex.escalationDeposits')
	if (!Array.isArray(index['migrationRepSplits'])) throw new Error('protocolIndex.migrationRepSplits must be an array')
	if (!Array.isArray(index['childRepSplits'])) throw new Error('protocolIndex.childRepSplits must be an array')
	const migrationRepSplits = index['migrationRepSplits'].map((progress, progressIndex) => parseMigrationRepSplitProgress(progress, `protocolIndex.migrationRepSplits[${progressIndex.toString()}]`))
	const childRepSplits = index['childRepSplits'].map((progress, progressIndex) => parseChildRepSplitProgress(progress, `protocolIndex.childRepSplits[${progressIndex.toString()}]`))
	assertStrictCanonicalOrder(migrationRepSplits, compareMigrationRoutes, 'protocolIndex.migrationRepSplits')
	assertStrictCanonicalOrder(childRepSplits, compareChildRoutes, 'protocolIndex.childRepSplits')
	return {
		...identity,
		auctionBids: auctionBidRecord(bids),
		auctionRefunds: auctionRefundRecord(refunds),
		childRepSplits,
		escalationDeposits,
		migrationRepSplits,
		reports,
	}
}

function deeplyFreeze(value: unknown) {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
	for (const child of Object.values(value)) deeplyFreeze(child)
	Object.freeze(value)
}

export function immutableProtocolIndex(index: ChaosProtocolIndex) {
	deeplyFreeze(index)
	validatedProtocolIndexes.add(index)
	return index
}
