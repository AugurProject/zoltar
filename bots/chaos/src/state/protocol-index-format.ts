import { collectionDigest, manifestWithDigest, sha256 } from './content-digest.ts'
import { parseJsonDocument } from '@zoltar/bot-shared/config/durable-file'

import { type Hex } from '@zoltar/bot-shared/ethereum'

import type { ChildRepSplitProgressSnapshot, EscalationDepositSnapshot, MigrationRepSplitProgressSnapshot, OracleGameSnapshot } from '#operations/types'

import { assertExactKeys, normalizedHash32 as hash, requiredRecord, unsignedIntegerString } from './validators.ts'
import {
	ProtocolIndexIdentity,
	MAXIMUM_PROTOCOL_INDEX_RECORDS,
	parseIdentity,
	AuctionBidRecord,
	AuctionRefundRecord,
	parseOracleGame,
	parseAuctionBidRecord,
	parseAuctionRefundRecord,
	parseEscalationDeposit,
	parseMigrationRepSplitProgress,
	parseChildRepSplitProgress,
	assertStrictCanonicalOrder,
	compareReports,
	compareAuctionBidRecords,
	compareAuctionRefundRecords,
	compareDeposits,
	compareMigrationRoutes,
	compareChildRoutes,
} from './protocol-index-schema.ts'
import { PreparedProtocolIndexChunk } from './protocol-index-store.ts'

export const PROTOCOL_INDEX_REFERENCE_VERSION = 1
const PROTOCOL_INDEX_MANIFEST_VERSION = 1
export const MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS = 256
export const MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES = 1024 * 1024
const MAXIMUM_PROTOCOL_INDEX_CHUNKS = 512
export const MAXIMUM_PROTOCOL_INDEX_BYTES = 64 * 1024 * 1024
export const MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES = 64 * 1024

export const COLLECTION_KINDS = ['reports', 'auction-bids', 'auction-refunds', 'escalation-deposits', 'migration-routes', 'child-routes'] as const

export type CollectionKind = (typeof COLLECTION_KINDS)[number]

export type ProtocolIndexReference = {
	kind: 'protocol-index-sidecar'
	manifestDigest: Hex
	schemaVersion: 1
}

export type CollectionCommitment = {
	byteCount: string
	chunkCount: string
	chunkDigests: Hex[]
	chunksDigest: Hex
	recordCount: string
}

type ProtocolIndexManifestPayload = {
	collections: Record<CollectionKind, CollectionCommitment>
	identity: ProtocolIndexIdentity
	indexSchemaVersion: 3
	schemaVersion: 1
}

type ProtocolIndexManifest = ProtocolIndexManifestPayload & {
	manifestDigest: Hex
}

export function manifestPayload(identity: ProtocolIndexIdentity, collections: Record<CollectionKind, CollectionCommitment>): ProtocolIndexManifestPayload {
	return {
		collections: {
			reports: collections.reports,
			'auction-bids': collections['auction-bids'],
			'auction-refunds': collections['auction-refunds'],
			'escalation-deposits': collections['escalation-deposits'],
			'migration-routes': collections['migration-routes'],
			'child-routes': collections['child-routes'],
		},
		identity,
		indexSchemaVersion: 3,
		schemaVersion: PROTOCOL_INDEX_MANIFEST_VERSION,
	}
}

export function chunkFilename(kind: CollectionKind, ordinal: number, digest: Hex) {
	return `${kind}-${ordinal.toString()}-${digest.slice(2)}.json`
}

export type PreparedProtocolIndexCollection = {
	commitment: CollectionCommitment
	chunks: PreparedProtocolIndexChunk[]
}

export type ProtocolIndexPreparationBudget = {
	bytes: number
	chunks: number
	records: number
}

export function prepareCollection(kind: CollectionKind, records: Iterable<unknown>, budget: ProtocolIndexPreparationBudget): PreparedProtocolIndexCollection {
	const digests: Hex[] = []
	const chunks: PreparedProtocolIndexChunk[] = []
	let byteCount = 0
	let recordCount = 0
	let chunk: unknown[] = []
	const flush = () => {
		if (chunk.length === 0) return
		const ordinal = digests.length
		const contents = `${JSON.stringify({ kind, ordinal: ordinal.toString(), records: chunk, schemaVersion: 1 })}\n`
		const contentsBytes = Buffer.byteLength(contents, 'utf8')
		if (contentsBytes > MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} exceeds the ${MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES.toString()}-byte safety limit`)
		if (budget.chunks + 1 > MAXIMUM_PROTOCOL_INDEX_CHUNKS) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_CHUNKS.toString()}-chunk aggregate safety limit`)
		if (budget.bytes + contentsBytes > MAXIMUM_PROTOCOL_INDEX_BYTES) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_BYTES.toString()}-byte aggregate safety limit`)
		const digest = sha256(contents)
		digests.push(digest)
		chunks.push({ contents, digest, filename: chunkFilename(kind, ordinal, digest) })
		budget.bytes += contentsBytes
		budget.chunks += 1
		byteCount += contentsBytes
		chunk = []
	}
	for (const record of records) {
		if (budget.records + 1 > MAXIMUM_PROTOCOL_INDEX_RECORDS) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_RECORDS.toString()}-record aggregate safety limit`)
		chunk.push(record)
		budget.records += 1
		recordCount += 1
		if (chunk.length === MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) flush()
	}
	flush()
	return {
		commitment: {
			byteCount: byteCount.toString(),
			chunkCount: digests.length.toString(),
			chunkDigests: digests,
			chunksDigest: collectionDigest(digests),
			recordCount: recordCount.toString(),
		},
		chunks,
	}
}

function parseCollectionCommitment(value: unknown, label: string): CollectionCommitment {
	const commitment = requiredRecord(value, label)
	assertExactKeys(commitment, ['byteCount', 'chunkCount', 'chunkDigests', 'chunksDigest', 'recordCount'], [], label)
	if (!Array.isArray(commitment['chunkDigests'])) throw new Error(`${label}.chunkDigests must be an array`)
	const chunkDigests = commitment['chunkDigests'].map((digest, index) => hash(digest, `${label}.chunkDigests[${index.toString()}]`))
	return {
		byteCount: unsignedIntegerString(commitment['byteCount'], `${label}.byteCount`),
		chunkCount: unsignedIntegerString(commitment['chunkCount'], `${label}.chunkCount`),
		chunkDigests,
		chunksDigest: hash(commitment['chunksDigest'], `${label}.chunksDigest`),
		recordCount: unsignedIntegerString(commitment['recordCount'], `${label}.recordCount`),
	}
}

export function validateManifestEnvelope(collections: Record<CollectionKind, CollectionCommitment>) {
	let totalBytes = 0
	let totalChunks = 0
	let totalRecords = 0
	for (const kind of COLLECTION_KINDS) {
		const commitment = collections[kind]
		const byteCount = safeCount(commitment.byteCount, `Protocol index ${kind} byte count`)
		const chunkCount = safeCount(commitment.chunkCount, `Protocol index ${kind} chunk count`)
		const recordCount = safeCount(commitment.recordCount, `Protocol index ${kind} record count`)
		const expectedChunkCount = Math.ceil(recordCount / MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS)
		if (chunkCount !== expectedChunkCount || commitment.chunkDigests.length !== chunkCount) throw new Error(`Protocol index ${kind} collection geometry does not match its manifest`)
		if ((chunkCount === 0) !== (byteCount === 0)) throw new Error(`Protocol index ${kind} collection byte count does not match its chunk count`)
		if (collectionDigest(commitment.chunkDigests) !== commitment.chunksDigest) throw new Error(`Protocol index ${kind} chunk-root digest does not match its manifest`)
		totalBytes += byteCount
		totalChunks += chunkCount
		totalRecords += recordCount
		if (totalBytes > MAXIMUM_PROTOCOL_INDEX_BYTES) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_BYTES.toString()}-byte aggregate safety limit`)
		if (totalChunks > MAXIMUM_PROTOCOL_INDEX_CHUNKS) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_CHUNKS.toString()}-chunk aggregate safety limit`)
		if (totalRecords > MAXIMUM_PROTOCOL_INDEX_RECORDS) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_RECORDS.toString()}-record aggregate safety limit`)
	}
}

export function parseManifest(value: unknown, expectedChainId: number, expectedDigest: Hex): ProtocolIndexManifest {
	const manifest = requiredRecord(value, 'protocol index manifest')
	assertExactKeys(manifest, ['collections', 'identity', 'indexSchemaVersion', 'manifestDigest', 'schemaVersion'], [], 'protocol index manifest')
	if (manifest['schemaVersion'] !== PROTOCOL_INDEX_MANIFEST_VERSION) throw new Error('Protocol index manifest schema is unsupported')
	if (manifest['indexSchemaVersion'] !== 3) throw new Error('Protocol index manifest refers to an unsupported index schema')
	const rawCollections = requiredRecord(manifest['collections'], 'protocol index manifest.collections')
	assertExactKeys(rawCollections, COLLECTION_KINDS, [], 'protocol index manifest.collections')
	const collections = Object.fromEntries(COLLECTION_KINDS.map(kind => [kind, parseCollectionCommitment(rawCollections[kind], `protocol index manifest.collections.${kind}`)])) as Record<CollectionKind, CollectionCommitment>
	validateManifestEnvelope(collections)
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

export function isReference(value: unknown) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>)['kind'] === 'protocol-index-sidecar'
}

export function safeCount(value: string, label: string) {
	if (value.length > 16) throw new Error(`${label} exceeds the runtime's safe iterable range`)
	const count = BigInt(value)
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the runtime's safe iterable range`)
	return Number(count)
}

export function parseChunkEnvelope(contents: string, kind: CollectionKind, ordinal: number) {
	const chunk = requiredRecord(parseJsonDocument(contents, `Protocol index ${kind} chunk ${ordinal.toString()}`), `protocol index ${kind} chunk ${ordinal.toString()}`)
	assertExactKeys(chunk, ['kind', 'ordinal', 'records', 'schemaVersion'], [], `protocol index ${kind} chunk ${ordinal.toString()}`)
	if (chunk['schemaVersion'] !== 1 || chunk['kind'] !== kind || chunk['ordinal'] !== ordinal.toString()) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} identity does not match its manifest position`)
	if (!Array.isArray(chunk['records']) || chunk['records'].length === 0 || chunk['records'].length > MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) {
		throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} must contain between 1 and ${MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS.toString()} records`)
	}
	return chunk['records']
}

type LoadedCollections = {
	auctionBids: AuctionBidRecord[]
	auctionRefunds: AuctionRefundRecord[]
	childRepSplits: ChildRepSplitProgressSnapshot[]
	escalationDeposits: EscalationDepositSnapshot[]
	migrationRepSplits: MigrationRepSplitProgressSnapshot[]
	reports: OracleGameSnapshot[]
}

export function emptyLoadedCollections(): LoadedCollections {
	return { auctionBids: [], auctionRefunds: [], childRepSplits: [], escalationDeposits: [], migrationRepSplits: [], reports: [] }
}

export function appendParsedRecord(collections: LoadedCollections, kind: CollectionKind, value: unknown, identity: ProtocolIndexIdentity, label: string) {
	if (kind === 'reports') collections.reports.push(parseOracleGame(value, label, identity.openOracle, BigInt(identity.cursor.blockNumber)))
	else if (kind === 'auction-bids') collections.auctionBids.push(parseAuctionBidRecord(value, label))
	else if (kind === 'auction-refunds') collections.auctionRefunds.push(parseAuctionRefundRecord(value, label))
	else if (kind === 'escalation-deposits') collections.escalationDeposits.push(parseEscalationDeposit(value, label))
	else if (kind === 'migration-routes') collections.migrationRepSplits.push(parseMigrationRepSplitProgress(value, label))
	else collections.childRepSplits.push(parseChildRepSplitProgress(value, label))
}

export function validateLoadedCollectionOrder(collections: LoadedCollections) {
	assertStrictCanonicalOrder(collections.reports, compareReports, 'protocolIndex.reports')
	assertStrictCanonicalOrder(collections.auctionBids, compareAuctionBidRecords, 'protocolIndex.auctionBids')
	assertStrictCanonicalOrder(collections.auctionRefunds, compareAuctionRefundRecords, 'protocolIndex.auctionRefunds')
	assertStrictCanonicalOrder(collections.escalationDeposits, compareDeposits, 'protocolIndex.escalationDeposits')
	assertStrictCanonicalOrder(collections.migrationRepSplits, compareMigrationRoutes, 'protocolIndex.migrationRepSplits')
	assertStrictCanonicalOrder(collections.childRepSplits, compareChildRoutes, 'protocolIndex.childRepSplits')
}
