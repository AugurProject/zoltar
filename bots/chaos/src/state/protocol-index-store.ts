import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '#monitoring/protocol-index'
import type { AuctionBidSnapshot, ChildRepSplitProgressSnapshot, EscalationDepositSnapshot, MigrationRepSplitProgressSnapshot, OracleGameSnapshot } from '#operations/types'

const PROTOCOL_INDEX_REFERENCE_VERSION = 1
const PROTOCOL_INDEX_MANIFEST_VERSION = 1
export const MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS = 256
export const MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES = 1024 * 1024
const MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES = 64 * 1024

const COLLECTION_KINDS = ['reports', 'auction-bids', 'escalation-deposits', 'migration-routes', 'child-routes'] as const
const GENERATION_NAME = /^[0-9a-f]{64}$/
const TEMPORARY_GENERATION_NAME = /^\.tmp-[0-9]+-[0-9a-f-]+$/
const CHUNK_FILE = /^(reports|auction-bids|escalation-deposits|migration-routes|child-routes)-(0|[1-9]\d*)-([0-9a-f]{64})\.json$/
const validatedProtocolIndexes = new WeakSet<ChaosProtocolIndex>()
const persistedReferences = new WeakMap<ChaosProtocolIndex, Map<string, ProtocolIndexReference>>()

type CollectionKind = (typeof COLLECTION_KINDS)[number]

export type ProtocolIndexReference = {
	kind: 'protocol-index-sidecar'
	manifestDigest: Hex
	schemaVersion: 1
}

export type ProtocolIndexFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	readFile: (options: { encoding: 'utf8' }) => Promise<string>
	stat: () => Promise<{
		isDirectory: () => boolean
		isFile: () => boolean
		mode: number
		size: number
		uid: number
	}>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type ProtocolIndexDirectoryEntry = {
	isDirectory: () => boolean
	isFile: () => boolean
	isSymbolicLink: () => boolean
	name: string
}

export type ProtocolIndexFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx' | number, mode?: number) => Promise<ProtocolIndexFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	readdir: (path: string, options: { withFileTypes: true }) => Promise<ProtocolIndexDirectoryEntry[]>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true; recursive?: true }) => Promise<unknown>
}

type ProtocolIndexIdentity = {
	chainId: number
	cursor: { blockHash: Hash; blockNumber: string }
	openOracle: Address
	schemaVersion: 2
	securityPoolForker: Address
	startBlock: string
	wallet: Address
	zoltar: Address
}

type CollectionCommitment = {
	chunkCount: string
	chunksDigest: Hex
	recordCount: string
}

type ProtocolIndexManifestPayload = {
	collections: Record<CollectionKind, CollectionCommitment>
	identity: ProtocolIndexIdentity
	indexSchemaVersion: 2
	schemaVersion: 1
}

type ProtocolIndexManifest = ProtocolIndexManifestPayload & {
	manifestDigest: Hex
}

type AuctionBidRecord = {
	auction: Address
	bid: AuctionBidSnapshot
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string) {
	const allowed = new Set([...required, ...optional])
	const unknown = Object.keys(record).filter(key => !allowed.has(key))
	const missing = required.filter(key => !(key in record))
	if (unknown.length !== 0) throw new Error(`${label} contains unsupported field ${unknown[0] ?? 'unknown'}`)
	if (missing.length !== 0) throw new Error(`${label} is missing ${missing[0] ?? 'a required field'}`)
}

function nonemptyString(value: unknown, label: string, maximumLength = 2_048) {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximumLength) throw new Error(`${label} must be a non-empty string of at most ${maximumLength.toString()} characters`)
	return value
}

function unsignedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	return value
}

function signedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an integer string`)
	return value
}

function boundedInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be an integer between 0 and ${maximum.toString()}`)
	return value
}

function hash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hash`)
	return value.toLowerCase() as Hex
}

function boundedUnsignedString(value: unknown, label: string, bits: number) {
	const parsed = unsignedIntegerString(value, label)
	const maximumDigits = Math.ceil(bits * Math.log10(2))
	if (parsed.length > maximumDigits) throw new Error(`${label} exceeds uint${bits.toString()}`)
	if (BigInt(parsed) >= 1n << BigInt(bits)) throw new Error(`${label} exceeds uint${bits.toString()}`)
	return parsed
}

function compareUnsignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

function compareSignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

function parseIdentity(value: unknown, expectedChainId: number, label = 'protocolIndex'): ProtocolIndexIdentity {
	const index = requiredRecord(value, label)
	assertExactKeys(index, ['chainId', 'cursor', 'openOracle', 'schemaVersion', 'securityPoolForker', 'startBlock', 'wallet', 'zoltar'], [], label)
	if (index['schemaVersion'] !== 2) throw new Error(`${label}.schemaVersion is unsupported`)
	if (index['chainId'] !== expectedChainId) throw new Error(`Protocol index belongs to chain ${String(index['chainId'])}, expected chain ${expectedChainId.toString()}`)
	const startBlock = boundedUnsignedString(index['startBlock'], `${label}.startBlock`, 256)
	const cursor = requiredRecord(index['cursor'], `${label}.cursor`)
	assertExactKeys(cursor, ['blockHash', 'blockNumber'], [], `${label}.cursor`)
	const cursorBlockNumber = boundedUnsignedString(cursor['blockNumber'], `${label}.cursor.blockNumber`, 256)
	if (BigInt(cursorBlockNumber) < BigInt(startBlock)) throw new Error(`${label}.cursor.blockNumber precedes ${label}.startBlock`)
	return {
		chainId: expectedChainId,
		cursor: { blockHash: hash(cursor['blockHash'], `${label}.cursor.blockHash`), blockNumber: cursorBlockNumber },
		openOracle: getAddress(nonemptyString(index['openOracle'], `${label}.openOracle`)),
		schemaVersion: 2,
		securityPoolForker: getAddress(nonemptyString(index['securityPoolForker'], `${label}.securityPoolForker`)),
		startBlock,
		wallet: getAddress(nonemptyString(index['wallet'], `${label}.wallet`)),
		zoltar: getAddress(nonemptyString(index['zoltar'], `${label}.zoltar`)),
	}
}

function parseOracleGame(value: unknown, label: string, expectedOpenOracle: Address, cursorBlockNumber: bigint): OracleGameSnapshot {
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

function parseAuctionBidRecord(value: unknown, label: string): AuctionBidRecord {
	const record = requiredRecord(value, label)
	assertExactKeys(record, ['auction', 'bid'], [], label)
	return {
		auction: getAddress(nonemptyString(record['auction'], `${label}.auction`)),
		bid: parseAuctionBid(record['bid'], `${label}.bid`),
	}
}

function parseEscalationDeposit(value: unknown, label: string): EscalationDepositSnapshot {
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

function parseMigrationRepSplitProgress(value: unknown, label: string): MigrationRepSplitProgressSnapshot {
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

function parseChildRepSplitProgress(value: unknown, label: string): ChildRepSplitProgressSnapshot {
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

function compareReports(left: OracleGameSnapshot, right: OracleGameSnapshot) {
	return compareUnsignedStrings(left.reportId, right.reportId)
}

function compareAuctionBidRecords(left: AuctionBidRecord, right: AuctionBidRecord) {
	const auctionOrder = left.auction.toLowerCase().localeCompare(right.auction.toLowerCase())
	if (auctionOrder !== 0) return auctionOrder
	const tickOrder = compareSignedStrings(left.bid.tick, right.bid.tick)
	return tickOrder === 0 ? compareUnsignedStrings(left.bid.index, right.bid.index) : tickOrder
}

function compareDeposits(left: EscalationDepositSnapshot, right: EscalationDepositSnapshot) {
	const gameOrder = left.escalationGame.toLowerCase().localeCompare(right.escalationGame.toLowerCase())
	if (gameOrder !== 0) return gameOrder
	if (left.outcome !== right.outcome) return left.outcome < right.outcome ? -1 : 1
	return compareUnsignedStrings(left.depositIndex, right.depositIndex)
}

function compareMigrationRoutes(left: MigrationRepSplitProgressSnapshot, right: MigrationRepSplitProgressSnapshot) {
	const universeOrder = compareUnsignedStrings(left.universeId, right.universeId)
	return universeOrder === 0 ? compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex) : universeOrder
}

function compareChildRoutes(left: ChildRepSplitProgressSnapshot, right: ChildRepSplitProgressSnapshot) {
	const poolOrder = left.pool.toLowerCase().localeCompare(right.pool.toLowerCase())
	return poolOrder === 0 ? compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex) : poolOrder
}

function assertStrictCanonicalOrder<T>(values: readonly T[], compare: (left: T, right: T) => number, label: string) {
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

function auctionBidRecord(records: readonly AuctionBidRecord[]) {
	const result: Record<string, AuctionBidSnapshot[]> = {}
	for (const record of records) {
		const key = record.auction.toLowerCase()
		const bids = result[key] ?? []
		bids.push(record.bid)
		result[key] = bids
	}
	return result
}

export function parseProtocolIndex(value: unknown, expectedChainId: number): ChaosProtocolIndex | undefined {
	if (value === null || value === undefined) return undefined
	const index = requiredRecord(value, 'protocolIndex')
	assertExactKeys(index, ['auctionBids', 'chainId', 'childRepSplits', 'cursor', 'escalationDeposits', 'migrationRepSplits', 'openOracle', 'reports', 'schemaVersion', 'securityPoolForker', 'startBlock', 'wallet', 'zoltar'], [], 'protocolIndex')
	const identity = parseIdentity(
		{
			chainId: index['chainId'],
			cursor: index['cursor'],
			openOracle: index['openOracle'],
			schemaVersion: index['schemaVersion'],
			securityPoolForker: index['securityPoolForker'],
			startBlock: index['startBlock'],
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

function immutableProtocolIndex(index: ChaosProtocolIndex) {
	deeplyFreeze(index)
	validatedProtocolIndexes.add(index)
	return index
}

function rememberedReference(index: ChaosProtocolIndex, statePath: string) {
	return persistedReferences.get(index)?.get(resolve(statePath))
}

function rememberReference(index: ChaosProtocolIndex, statePath: string, reference: ProtocolIndexReference) {
	const references = persistedReferences.get(index) ?? new Map<string, ProtocolIndexReference>()
	references.set(resolve(statePath), reference)
	persistedReferences.set(index, references)
}

export function snapshotProtocolIndex(index: ChaosProtocolIndex, expectedChainId: number) {
	if (validatedProtocolIndexes.has(index)) return index
	const parsed = parseProtocolIndex(index, expectedChainId)
	if (parsed === undefined) throw new Error('Cannot snapshot an absent protocol index')
	return immutableProtocolIndex(parsed)
}

function sha256(value: string) {
	return `0x${createHash('sha256').update(value, 'utf8').digest('hex')}` as Hex
}

function manifestPayload(identity: ProtocolIndexIdentity, collections: Record<CollectionKind, CollectionCommitment>): ProtocolIndexManifestPayload {
	return {
		collections: {
			reports: collections.reports,
			'auction-bids': collections['auction-bids'],
			'escalation-deposits': collections['escalation-deposits'],
			'migration-routes': collections['migration-routes'],
			'child-routes': collections['child-routes'],
		},
		identity,
		indexSchemaVersion: 2,
		schemaVersion: PROTOCOL_INDEX_MANIFEST_VERSION,
	}
}

function manifestWithDigest(payload: ProtocolIndexManifestPayload): ProtocolIndexManifest {
	return { ...payload, manifestDigest: sha256(JSON.stringify(payload)) }
}

function collectionDigest(digests: readonly Hex[]) {
	const hasher = createHash('sha256')
	for (let ordinal = 0; ordinal < digests.length; ordinal += 1) hasher.update(`${ordinal.toString()}:${digests[ordinal] ?? ''}\n`, 'utf8')
	return `0x${hasher.digest('hex')}` as Hex
}

function errorCode(error: unknown) {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

async function ownerDirectory(path: string, filesystem: ProtocolIndexFilesystem, label: string) {
	let handle: ProtocolIndexFileHandle | undefined
	try {
		handle = await filesystem.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isDirectory()) throw new Error(`${label} ${path} must be a directory`)
		if ((metadata.mode & 0o777) !== 0o700) throw new Error(`${label} ${path} must have owner-only mode 0700`)
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${label} ${path} must be owned by the bot process user`)
	} catch (error) {
		if (errorCode(error) === 'ELOOP') throw new Error(`${label} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

async function readOwnerFile(path: string, filesystem: ProtocolIndexFilesystem, maximumBytes: number, label: string) {
	let handle: ProtocolIndexFileHandle | undefined
	try {
		handle = await filesystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isFile()) throw new Error(`${label} ${path} must be a regular file`)
		if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${label} ${path} must have owner-only mode 0600`)
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${label} ${path} must be owned by the bot process user`)
		if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maximumBytes) throw new Error(`${label} ${path} exceeds its ${maximumBytes.toString()}-byte safety limit`)
		const contents = await handle.readFile({ encoding: 'utf8' })
		if (Buffer.byteLength(contents, 'utf8') > maximumBytes) throw new Error(`${label} ${path} exceeds its ${maximumBytes.toString()}-byte safety limit`)
		return contents
	} catch (error) {
		if (errorCode(error) === 'ELOOP') throw new Error(`${label} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

async function writeOwnerFile(path: string, contents: string, filesystem: ProtocolIndexFilesystem) {
	const handle = await filesystem.open(path, 'wx', 0o600)
	try {
		await handle.writeFile(contents, { encoding: 'utf8' })
		await handle.chmod(0o600)
		await handle.sync()
	} finally {
		await handle.close()
	}
}

async function syncDirectory(path: string, filesystem: ProtocolIndexFilesystem) {
	const handle = await filesystem.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

export function protocolIndexSidecarDirectory(statePath: string) {
	return `${resolve(statePath)}.protocol-index-v1`
}

function generationDirectory(statePath: string, manifestDigest: Hex) {
	return `${protocolIndexSidecarDirectory(statePath)}/${manifestDigest.slice(2)}`
}

function chunkFilename(kind: CollectionKind, ordinal: number, digest: Hex) {
	return `${kind}-${ordinal.toString()}-${digest.slice(2)}.json`
}

async function writeCollection(path: string, kind: CollectionKind, records: Iterable<unknown>, filesystem: ProtocolIndexFilesystem): Promise<CollectionCommitment> {
	const digests: Hex[] = []
	let recordCount = 0n
	let chunk: unknown[] = []
	const flush = async () => {
		if (chunk.length === 0) return
		const ordinal = digests.length
		const contents = `${JSON.stringify({ kind, ordinal: ordinal.toString(), records: chunk, schemaVersion: 1 })}\n`
		if (Buffer.byteLength(contents, 'utf8') > MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} exceeds the ${MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES.toString()}-byte safety limit`)
		const digest = sha256(contents)
		await writeOwnerFile(`${path}/${chunkFilename(kind, ordinal, digest)}`, contents, filesystem)
		digests.push(digest)
		chunk = []
	}
	for (const record of records) {
		chunk.push(record)
		recordCount += 1n
		if (chunk.length === MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) await flush()
	}
	await flush()
	return {
		chunkCount: digests.length.toString(),
		chunksDigest: collectionDigest(digests),
		recordCount: recordCount.toString(),
	}
}

function* auctionBidRecords(index: ChaosProtocolIndex): Generator<AuctionBidRecord> {
	for (const [auction, bids] of Object.entries(index.auctionBids)) {
		for (const bid of bids) yield { auction: getAddress(auction), bid }
	}
	return
}

function parseCollectionCommitment(value: unknown, label: string): CollectionCommitment {
	const commitment = requiredRecord(value, label)
	assertExactKeys(commitment, ['chunkCount', 'chunksDigest', 'recordCount'], [], label)
	return {
		chunkCount: unsignedIntegerString(commitment['chunkCount'], `${label}.chunkCount`),
		chunksDigest: hash(commitment['chunksDigest'], `${label}.chunksDigest`),
		recordCount: unsignedIntegerString(commitment['recordCount'], `${label}.recordCount`),
	}
}

function parseManifest(value: unknown, expectedChainId: number, expectedDigest: Hex): ProtocolIndexManifest {
	const manifest = requiredRecord(value, 'protocol index manifest')
	assertExactKeys(manifest, ['collections', 'identity', 'indexSchemaVersion', 'manifestDigest', 'schemaVersion'], [], 'protocol index manifest')
	if (manifest['schemaVersion'] !== PROTOCOL_INDEX_MANIFEST_VERSION) throw new Error('Protocol index manifest schema is unsupported')
	if (manifest['indexSchemaVersion'] !== 2) throw new Error('Protocol index manifest refers to an unsupported index schema')
	const rawCollections = requiredRecord(manifest['collections'], 'protocol index manifest.collections')
	assertExactKeys(rawCollections, COLLECTION_KINDS, [], 'protocol index manifest.collections')
	const collections = Object.fromEntries(COLLECTION_KINDS.map(kind => [kind, parseCollectionCommitment(rawCollections[kind], `protocol index manifest.collections.${kind}`)])) as Record<CollectionKind, CollectionCommitment>
	const identity = parseIdentity(manifest['identity'], expectedChainId, 'protocol index manifest.identity')
	const parsed = manifestWithDigest(manifestPayload(identity, collections))
	const recordedDigest = hash(manifest['manifestDigest'], 'protocol index manifest.manifestDigest')
	if (recordedDigest !== parsed.manifestDigest || recordedDigest !== expectedDigest.toLowerCase()) throw new Error('Protocol index manifest digest does not match its committed identity and collections')
	return parsed
}

export function parseProtocolIndexReference(value: unknown): ProtocolIndexReference {
	const reference = requiredRecord(value, 'protocolIndex reference')
	assertExactKeys(reference, ['kind', 'manifestDigest', 'schemaVersion'], [], 'protocolIndex reference')
	if (reference['kind'] !== 'protocol-index-sidecar' || reference['schemaVersion'] !== PROTOCOL_INDEX_REFERENCE_VERSION) throw new Error('protocolIndex reference schema is unsupported')
	return {
		kind: 'protocol-index-sidecar',
		manifestDigest: hash(reference['manifestDigest'], 'protocolIndex reference.manifestDigest'),
		schemaVersion: PROTOCOL_INDEX_REFERENCE_VERSION,
	}
}

function isReference(value: unknown) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>)['kind'] === 'protocol-index-sidecar'
}

function parseJson(contents: string, label: string) {
	try {
		return JSON.parse(contents) as unknown
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON: ${error.message}`)
		throw error
	}
}

function safeCount(value: string, label: string) {
	if (value.length > 16) throw new Error(`${label} exceeds the runtime's safe iterable range`)
	const count = BigInt(value)
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the runtime's safe iterable range`)
	return Number(count)
}

type CollectionFiles = Map<number, { digest: Hex; name: string }>

function indexedCollectionFiles(entries: readonly ProtocolIndexDirectoryEntry[]) {
	const files = Object.fromEntries(COLLECTION_KINDS.map(kind => [kind, new Map()])) as Record<CollectionKind, CollectionFiles>
	for (const entry of entries) {
		if (entry.name === 'manifest.json') {
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Protocol index manifest must be a regular non-symbolic-link file')
			continue
		}
		const match = CHUNK_FILE.exec(entry.name)
		if (match === null) throw new Error(`Protocol index generation contains unsupported entry ${entry.name}`)
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Protocol index chunk ${entry.name} must be a regular non-symbolic-link file`)
		const kind = match[1] as CollectionKind
		const ordinalText = match[2]
		const digestText = match[3]
		if (ordinalText === undefined || digestText === undefined) throw new Error(`Protocol index chunk ${entry.name} has an invalid identity`)
		const ordinal = safeCount(ordinalText, `Protocol index chunk ${entry.name} ordinal`)
		if (files[kind].has(ordinal)) throw new Error(`Protocol index generation contains duplicate ${kind} chunk ordinal ${ordinal.toString()}`)
		files[kind].set(ordinal, { digest: `0x${digestText}` as Hex, name: entry.name })
	}
	return files
}

function parseChunkEnvelope(contents: string, kind: CollectionKind, ordinal: number) {
	const chunk = requiredRecord(parseJson(contents, `Protocol index ${kind} chunk ${ordinal.toString()}`), `protocol index ${kind} chunk ${ordinal.toString()}`)
	assertExactKeys(chunk, ['kind', 'ordinal', 'records', 'schemaVersion'], [], `protocol index ${kind} chunk ${ordinal.toString()}`)
	if (chunk['schemaVersion'] !== 1 || chunk['kind'] !== kind || chunk['ordinal'] !== ordinal.toString()) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} identity does not match its manifest position`)
	if (!Array.isArray(chunk['records']) || chunk['records'].length === 0 || chunk['records'].length > MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) {
		throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} must contain between 1 and ${MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS.toString()} records`)
	}
	return chunk['records']
}

type LoadedCollections = {
	auctionBids: AuctionBidRecord[]
	childRepSplits: ChildRepSplitProgressSnapshot[]
	escalationDeposits: EscalationDepositSnapshot[]
	migrationRepSplits: MigrationRepSplitProgressSnapshot[]
	reports: OracleGameSnapshot[]
}

function emptyLoadedCollections(): LoadedCollections {
	return { auctionBids: [], childRepSplits: [], escalationDeposits: [], migrationRepSplits: [], reports: [] }
}

function appendParsedRecord(collections: LoadedCollections, kind: CollectionKind, value: unknown, identity: ProtocolIndexIdentity, label: string) {
	if (kind === 'reports') collections.reports.push(parseOracleGame(value, label, identity.openOracle, BigInt(identity.cursor.blockNumber)))
	else if (kind === 'auction-bids') collections.auctionBids.push(parseAuctionBidRecord(value, label))
	else if (kind === 'escalation-deposits') collections.escalationDeposits.push(parseEscalationDeposit(value, label))
	else if (kind === 'migration-routes') collections.migrationRepSplits.push(parseMigrationRepSplitProgress(value, label))
	else collections.childRepSplits.push(parseChildRepSplitProgress(value, label))
}

function validateLoadedCollectionOrder(collections: LoadedCollections) {
	assertStrictCanonicalOrder(collections.reports, compareReports, 'protocolIndex.reports')
	assertStrictCanonicalOrder(collections.auctionBids, compareAuctionBidRecords, 'protocolIndex.auctionBids')
	assertStrictCanonicalOrder(collections.escalationDeposits, compareDeposits, 'protocolIndex.escalationDeposits')
	assertStrictCanonicalOrder(collections.migrationRepSplits, compareMigrationRoutes, 'protocolIndex.migrationRepSplits')
	assertStrictCanonicalOrder(collections.childRepSplits, compareChildRoutes, 'protocolIndex.childRepSplits')
}

async function loadProtocolIndexGeneration(statePath: string, reference: ProtocolIndexReference, expectedChainId: number, filesystem: ProtocolIndexFilesystem): Promise<ChaosProtocolIndex> {
	const storePath = protocolIndexSidecarDirectory(statePath)
	const generationPath = generationDirectory(statePath, reference.manifestDigest)
	await ownerDirectory(storePath, filesystem, 'Protocol index store')
	await ownerDirectory(generationPath, filesystem, 'Protocol index generation')
	const manifestContents = await readOwnerFile(`${generationPath}/manifest.json`, filesystem, MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES, 'Protocol index manifest')
	const manifest = parseManifest(parseJson(manifestContents, 'Protocol index manifest'), expectedChainId, reference.manifestDigest)
	const entries = await filesystem.readdir(generationPath, { withFileTypes: true })
	if (!entries.some(entry => entry.name === 'manifest.json')) throw new Error('Protocol index generation is missing manifest.json')
	const collectionFiles = indexedCollectionFiles(entries)
	const loaded = emptyLoadedCollections()
	for (const kind of COLLECTION_KINDS) {
		const commitment = manifest.collections[kind]
		const expectedChunkCount = safeCount(commitment.chunkCount, `Protocol index ${kind} chunk count`)
		const files = collectionFiles[kind]
		if (files.size !== expectedChunkCount) throw new Error(`Protocol index ${kind} collection is missing or has extra chunks`)
		const digests: Hex[] = []
		let parsedRecordCount = 0n
		for (let ordinal = 0; ordinal < expectedChunkCount; ordinal += 1) {
			const file = files.get(ordinal)
			if (file === undefined) throw new Error(`Protocol index ${kind} collection is missing chunk ${ordinal.toString()}`)
			const contents = await readOwnerFile(`${generationPath}/${file.name}`, filesystem, MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES, 'Protocol index chunk')
			const actualDigest = sha256(contents)
			if (actualDigest !== file.digest) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} digest does not match its immutable filename`)
			digests.push(actualDigest)
			const records = parseChunkEnvelope(contents, kind, ordinal)
			if (ordinal + 1 < expectedChunkCount && records.length !== MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} is not a complete canonical chunk`)
			for (let index = 0; index < records.length; index += 1) {
				appendParsedRecord(loaded, kind, records[index], manifest.identity, `protocolIndex.${kind}[${parsedRecordCount.toString()}]`)
				parsedRecordCount += 1n
			}
		}
		if (parsedRecordCount.toString() !== commitment.recordCount) throw new Error(`Protocol index ${kind} record count does not match its manifest`)
		if (collectionDigest(digests) !== commitment.chunksDigest) throw new Error(`Protocol index ${kind} chunk-root digest does not match its manifest`)
	}
	validateLoadedCollectionOrder(loaded)
	const index = immutableProtocolIndex({
		...manifest.identity,
		auctionBids: auctionBidRecord(loaded.auctionBids),
		childRepSplits: loaded.childRepSplits,
		escalationDeposits: loaded.escalationDeposits,
		migrationRepSplits: loaded.migrationRepSplits,
		reports: loaded.reports,
	})
	rememberReference(index, statePath, reference)
	return index
}

function isExistingTargetError(error: unknown) {
	const code = errorCode(error)
	return code === 'EEXIST' || code === 'ENOTEMPTY'
}

async function validateCachedGeneration(statePath: string, reference: ProtocolIndexReference, expectedChainId: number, filesystem: ProtocolIndexFilesystem) {
	const storePath = protocolIndexSidecarDirectory(statePath)
	const targetPath = generationDirectory(statePath, reference.manifestDigest)
	await ownerDirectory(storePath, filesystem, 'Protocol index store')
	await ownerDirectory(targetPath, filesystem, 'Protocol index generation')
	const contents = await readOwnerFile(`${targetPath}/manifest.json`, filesystem, MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES, 'Protocol index manifest')
	parseManifest(parseJson(contents, 'Protocol index manifest'), expectedChainId, reference.manifestDigest)
}

export async function persistProtocolIndexGeneration(statePath: string, index: ChaosProtocolIndex, filesystem: ProtocolIndexFilesystem): Promise<ProtocolIndexReference> {
	const cachedReference = rememberedReference(index, statePath)
	if (cachedReference !== undefined) {
		try {
			await validateCachedGeneration(statePath, cachedReference, index.chainId, filesystem)
			return cachedReference
		} catch (error) {
			if (errorCode(error) !== 'ENOENT') throw error
			persistedReferences.get(index)?.delete(resolve(statePath))
		}
	}
	const parsed = snapshotProtocolIndex(index, index.chainId)
	const storePath = protocolIndexSidecarDirectory(statePath)
	await filesystem.mkdir(storePath, { mode: 0o700, recursive: true })
	await ownerDirectory(storePath, filesystem, 'Protocol index store')
	const temporaryPath = `${storePath}/.tmp-${process.pid.toString()}-${randomUUID()}`
	await filesystem.mkdir(temporaryPath, { mode: 0o700, recursive: true })
	await ownerDirectory(temporaryPath, filesystem, 'Temporary protocol index generation')
	let renamed = false
	try {
		const collections = {
			'auction-bids': await writeCollection(temporaryPath, 'auction-bids', auctionBidRecords(parsed), filesystem),
			'child-routes': await writeCollection(temporaryPath, 'child-routes', parsed.childRepSplits, filesystem),
			'escalation-deposits': await writeCollection(temporaryPath, 'escalation-deposits', parsed.escalationDeposits, filesystem),
			'migration-routes': await writeCollection(temporaryPath, 'migration-routes', parsed.migrationRepSplits, filesystem),
			reports: await writeCollection(temporaryPath, 'reports', parsed.reports, filesystem),
		}
		const identity: ProtocolIndexIdentity = {
			chainId: parsed.chainId,
			cursor: parsed.cursor,
			openOracle: parsed.openOracle,
			schemaVersion: 2,
			securityPoolForker: parsed.securityPoolForker,
			startBlock: parsed.startBlock,
			wallet: parsed.wallet,
			zoltar: parsed.zoltar,
		}
		const manifest = manifestWithDigest(manifestPayload(identity, collections))
		const manifestContents = `${JSON.stringify(manifest)}\n`
		if (Buffer.byteLength(manifestContents, 'utf8') > MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES) throw new Error('Protocol index manifest exceeds its fixed safety envelope')
		await writeOwnerFile(`${temporaryPath}/manifest.json`, manifestContents, filesystem)
		await syncDirectory(temporaryPath, filesystem)
		const reference: ProtocolIndexReference = { kind: 'protocol-index-sidecar', manifestDigest: manifest.manifestDigest, schemaVersion: PROTOCOL_INDEX_REFERENCE_VERSION }
		const targetPath = generationDirectory(statePath, reference.manifestDigest)
		try {
			await filesystem.rename(temporaryPath, targetPath)
			renamed = true
			await syncDirectory(storePath, filesystem)
		} catch (error) {
			if (!isExistingTargetError(error)) throw error
			await filesystem.rm(temporaryPath, { force: true, recursive: true })
		}
		await loadProtocolIndexGeneration(statePath, reference, parsed.chainId, filesystem)
		rememberReference(parsed, statePath, reference)
		return reference
	} catch (error) {
		if (!renamed) await filesystem.rm(temporaryPath, { force: true, recursive: true })
		throw error
	}
}

export async function loadPersistedProtocolIndex(value: unknown, statePath: string, expectedChainId: number, filesystem: ProtocolIndexFilesystem) {
	if (value === null) return undefined
	if (!isReference(value)) {
		const inline = parseProtocolIndex(value, expectedChainId)
		return inline === undefined ? undefined : immutableProtocolIndex(inline)
	}
	const reference = parseProtocolIndexReference(value)
	return loadProtocolIndexGeneration(statePath, reference, expectedChainId, filesystem)
}

export async function pruneProtocolIndexGenerations(statePath: string, retainedReference: ProtocolIndexReference | undefined, filesystem: ProtocolIndexFilesystem) {
	const storePath = protocolIndexSidecarDirectory(statePath)
	try {
		await ownerDirectory(storePath, filesystem, 'Protocol index store')
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return
		throw error
	}
	const retainedName = retainedReference?.manifestDigest.slice(2)
	const entries = await filesystem.readdir(storePath, { withFileTypes: true })
	for (const entry of entries) {
		if (entry.name === retainedName) continue
		if (!GENERATION_NAME.test(entry.name) && !TEMPORARY_GENERATION_NAME.test(entry.name)) continue
		await filesystem.rm(`${storePath}/${entry.name}`, { force: true, recursive: true })
	}
	await syncDirectory(storePath, filesystem)
}
