import { parseTopologyIdentity as parseIdentity, type ImmutableTopologyIdentity } from './topology-identity.ts'
import { parseJsonDocument } from '@zoltar/bot-shared/config/durable-file'

import { type Hex } from '@zoltar/bot-shared/ethereum'
import { compareUnsignedStrings } from '../core/units.ts'

import { manifestWithDigest } from '../state/content-digest.ts'
import { assertExactKeys, normalizedHash32 as hash, requiredRecord, uint256String as unsignedIntegerString } from '../state/validators.ts'
import {
	ImmutableTopologyDiscoveryCursors,
	CanonicalImmutableTopologyCache,
	IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
	parseCountedRegistryCursor,
	ImmutableTopologyResidentLimits,
	IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES,
	IMMUTABLE_TOPOLOGY_MAXIMUM_RESIDENT_ITEMS,
	requireResidentLimit,
	configuredResidentLimitError,
	boundedString,
} from './topology-schema.ts'

const TOPOLOGY_STORE_SCHEMA_VERSION = 2
const TOPOLOGY_MANIFEST_SCHEMA_VERSION = 2
export const TOPOLOGY_POINTER_SCHEMA_VERSION = 1
export const TOPOLOGY_CHUNK_SCHEMA_VERSION = 1
export const TOPOLOGY_CHUNK_RECORDS = 256
export const COLLECTION_KINDS = ['pairs', 'pool-deployments', 'questions', 'universe-children', 'vault-cursors', 'vaults'] as const
export type CollectionKind = (typeof COLLECTION_KINDS)[number]

export type CollectionCommitment = {
	chunkCount: string
	chunksDigest: Hex
	committedBytes: string
	itemCount: string
	recordCount: string
}

type ManifestDiscoveryCursors = Pick<ImmutableTopologyDiscoveryCursors, 'poolDeployments' | 'questions'>

type TopologyManifestPayload = {
	anchor: CanonicalImmutableTopologyCache['anchor']
	collections: Record<CollectionKind, CollectionCommitment>
	discoveryCursors: ManifestDiscoveryCursors
	identity: ImmutableTopologyIdentity
	manifestSchemaVersion: 2
	payloadSchemaVersion: typeof IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION
	storeSchemaVersion: 2
}

type TopologyManifest = TopologyManifestPayload & {
	manifestDigest: Hex
}

export type TopologyPointer = {
	manifestDigest: Hex
	schemaVersion: 1
}

function parseManifestDiscoveryCursors(value: unknown, label: string): ManifestDiscoveryCursors {
	const cursors = requiredRecord(value, label)
	assertExactKeys(cursors, ['poolDeployments', 'questions'], [], label)
	return {
		poolDeployments: parseCountedRegistryCursor(cursors['poolDeployments'], `${label}.poolDeployments`),
		questions: parseCountedRegistryCursor(cursors['questions'], `${label}.questions`),
	}
}

export function manifestPayload(parameters: Omit<TopologyManifestPayload, 'manifestSchemaVersion' | 'payloadSchemaVersion' | 'storeSchemaVersion'>): TopologyManifestPayload {
	return {
		...parameters,
		manifestSchemaVersion: TOPOLOGY_MANIFEST_SCHEMA_VERSION,
		payloadSchemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		storeSchemaVersion: TOPOLOGY_STORE_SCHEMA_VERSION,
	}
}

export function chunkFilename(kind: CollectionKind, ordinal: number, digest: Hex) {
	return `${kind}-${ordinal.toString()}-${digest.slice(2)}.json`
}

export function parsePointer(value: unknown): TopologyPointer {
	const pointer = requiredRecord(value, 'immutable topology pointer')
	assertExactKeys(pointer, ['manifestDigest', 'schemaVersion'], [], 'immutable topology pointer')
	if (pointer['schemaVersion'] !== TOPOLOGY_POINTER_SCHEMA_VERSION) throw new Error('Immutable topology pointer schema is unsupported')
	return { manifestDigest: hash(pointer['manifestDigest'], 'immutable topology pointer.manifestDigest'), schemaVersion: TOPOLOGY_POINTER_SCHEMA_VERSION }
}

function parseCollectionCommitment(value: unknown, label: string): CollectionCommitment {
	const commitment = requiredRecord(value, label)
	assertExactKeys(commitment, ['chunkCount', 'chunksDigest', 'committedBytes', 'itemCount', 'recordCount'], [], label)
	const chunkCount = unsignedIntegerString(commitment['chunkCount'], `${label}.chunkCount`)
	const committedBytes = unsignedIntegerString(commitment['committedBytes'], `${label}.committedBytes`)
	const itemCount = unsignedIntegerString(commitment['itemCount'], `${label}.itemCount`)
	const recordCount = unsignedIntegerString(commitment['recordCount'], `${label}.recordCount`)
	if (BigInt(chunkCount) > BigInt(recordCount)) throw new Error(`${label}.chunkCount exceeds its record count`)
	if (BigInt(recordCount) > BigInt(itemCount)) throw new Error(`${label}.recordCount exceeds its resident item count`)
	if (recordCount === '0' && (chunkCount !== '0' || committedBytes !== '0' || itemCount !== '0')) throw new Error(`${label} has a non-empty commitment for an empty collection`)
	return {
		chunkCount,
		chunksDigest: hash(commitment['chunksDigest'], `${label}.chunksDigest`),
		committedBytes,
		itemCount,
		recordCount,
	}
}

export function parseManifest(value: unknown, expectedDigest: Hex): TopologyManifest {
	const manifest = requiredRecord(value, 'immutable topology manifest')
	assertExactKeys(manifest, ['anchor', 'collections', 'discoveryCursors', 'identity', 'manifestDigest', 'manifestSchemaVersion', 'payloadSchemaVersion', 'storeSchemaVersion'], [], 'immutable topology manifest')
	if (manifest['manifestSchemaVersion'] !== TOPOLOGY_MANIFEST_SCHEMA_VERSION || manifest['payloadSchemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION || manifest['storeSchemaVersion'] !== TOPOLOGY_STORE_SCHEMA_VERSION) {
		throw new Error('Immutable topology manifest schema is unsupported')
	}
	const anchor = requiredRecord(manifest['anchor'], 'immutable topology manifest.anchor')
	assertExactKeys(anchor, ['blockHash', 'blockNumber'], [], 'immutable topology manifest.anchor')
	const rawCollections = requiredRecord(manifest['collections'], 'immutable topology manifest.collections')
	assertExactKeys(rawCollections, COLLECTION_KINDS, [], 'immutable topology manifest.collections')
	const collections = Object.fromEntries(COLLECTION_KINDS.map(kind => [kind, parseCollectionCommitment(rawCollections[kind], `immutable topology manifest.collections.${kind}`)])) as Record<CollectionKind, CollectionCommitment>
	const payload = manifestPayload({
		anchor: {
			blockHash: hash(anchor['blockHash'], 'immutable topology manifest.anchor.blockHash'),
			blockNumber: unsignedIntegerString(anchor['blockNumber'], 'immutable topology manifest.anchor.blockNumber'),
		},
		collections,
		discoveryCursors: parseManifestDiscoveryCursors(manifest['discoveryCursors'], 'immutable topology manifest.discoveryCursors'),
		identity: parseIdentity(manifest['identity'], 'immutable topology manifest.identity'),
	})
	const parsed = manifestWithDigest(payload)
	const recordedDigest = hash(manifest['manifestDigest'], 'immutable topology manifest.manifestDigest')
	if (recordedDigest !== expectedDigest.toLowerCase() || recordedDigest !== parsed.manifestDigest) throw new Error('Immutable topology manifest digest does not match its committed payload')
	return parsed
}

export function safeCount(value: string, label: string) {
	const count = BigInt(value)
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the runtime safe iterable range`)
	return Number(count)
}

export type TopologyCollectionRecord = {
	items: number
	value: unknown
}

export function* topologyCollectionRecords(cache: CanonicalImmutableTopologyCache, kind: CollectionKind): Generator<TopologyCollectionRecord> {
	if (kind === 'pairs') {
		for (const pool of Object.keys(cache.pairsByPool).sort((left, right) => left.localeCompare(right))) yield { items: 1, value: { pair: cache.pairsByPool[pool], pool } }
		return
	}
	if (kind === 'pool-deployments') {
		for (const deployment of cache.poolDeployments) yield { items: 1, value: deployment }
		return
	}
	if (kind === 'questions') {
		for (const question of cache.questions) yield { items: 1 + question.outcomeLabels.length, value: question }
		return
	}
	if (kind === 'universe-children') {
		for (const universeId of Object.keys(cache.universeChildren).sort(compareUnsignedStrings)) {
			const children = cache.universeChildren[universeId]
			if (children === undefined) throw new Error(`Immutable topology universe ${universeId} disappeared during persistence`)
			yield { items: 1 + children.childUniverseIds.length + children.outcomeIndexes.length, value: { ...children, universeId } }
		}
		return
	}
	if (kind === 'vault-cursors') {
		for (const pool of Object.keys(cache.discoveryCursors.vaultsByPool).sort((left, right) => left.localeCompare(right))) {
			const cursor = cache.discoveryCursors.vaultsByPool[pool]
			if (cursor === undefined) throw new Error(`Immutable topology vault cursor ${pool} disappeared during persistence`)
			yield { items: 1, value: { cursor, pool } }
		}
		return
	}
	for (const pool of Object.keys(cache.vaultsByPool).sort((left, right) => left.localeCompare(right))) {
		const vaults = cache.vaultsByPool[pool]
		if (vaults === undefined) throw new Error(`Immutable topology vault registry ${pool} disappeared during persistence`)
		yield { items: 1 + vaults.length, value: { pool, vaults } }
	}
	return
}

export function collectionStatistics(cache: CanonicalImmutableTopologyCache, kind: CollectionKind) {
	let itemCount = 0n
	let recordCount = 0n
	for (const record of topologyCollectionRecords(cache, kind)) {
		itemCount += BigInt(record.items)
		recordCount += 1n
	}
	return { itemCount: itemCount.toString(), recordCount: recordCount.toString() }
}

export function assertManifestResidentBounds(manifest: TopologyManifest, limits?: ImmutableTopologyResidentLimits) {
	let committedBytes = 0n
	let itemCount = 0n
	for (const kind of COLLECTION_KINDS) {
		const commitment = manifest.collections[kind]
		committedBytes += BigInt(commitment.committedBytes)
		itemCount += BigInt(commitment.itemCount)
	}
	if (committedBytes > BigInt(IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES)) throw new Error('Immutable topology manifest exceeds its aggregate committed-byte safety limit')
	if (itemCount > BigInt(IMMUTABLE_TOPOLOGY_MAXIMUM_RESIDENT_ITEMS)) throw new Error('Immutable topology manifest exceeds its aggregate resident-item safety limit')
	if (limits === undefined) return
	requireResidentLimit(limits.maxPools, 'Immutable topology maxPools')
	requireResidentLimit(limits.maxQuestions, 'Immutable topology maxQuestions')
	requireResidentLimit(limits.maxUniverses, 'Immutable topology maxUniverses')
	requireResidentLimit(limits.maxVaultsPerPool, 'Immutable topology maxVaultsPerPool')
	if (BigInt(manifest.collections['pool-deployments'].recordCount) > BigInt(limits.maxPools)) throw configuredResidentLimitError('Immutable topology manifest exceeds the configured pool resident limit')
	if (BigInt(manifest.collections.questions.recordCount) > BigInt(limits.maxQuestions)) throw configuredResidentLimitError('Immutable topology manifest exceeds the configured question resident limit')
	if (BigInt(manifest.collections['universe-children'].recordCount) > BigInt(limits.maxUniverses)) throw configuredResidentLimitError('Immutable topology manifest exceeds the configured universe resident limit')
	if (BigInt(manifest.collections['universe-children'].itemCount) > BigInt(limits.maxUniverses) * 3n) throw configuredResidentLimitError('Immutable topology manifest exceeds the configured universe route resident limit')
	if (BigInt(manifest.collections.pairs.recordCount) > BigInt(limits.maxPools)) throw configuredResidentLimitError('Immutable topology manifest contains more pairs than the configured pool limit')
	if (BigInt(manifest.collections['vault-cursors'].recordCount) > BigInt(limits.maxPools)) throw configuredResidentLimitError('Immutable topology manifest contains more vault cursors than the configured pool limit')
	if (BigInt(manifest.collections.vaults.recordCount) > BigInt(limits.maxPools)) throw configuredResidentLimitError('Immutable topology manifest contains more vault registries than the configured pool limit')
	if (BigInt(manifest.collections.vaults.itemCount) > BigInt(limits.maxPools) * (BigInt(limits.maxVaultsPerPool) + 1n)) throw configuredResidentLimitError('Immutable topology manifest exceeds the configured aggregate vault resident limit')
}

type CollectionFiles = Record<CollectionKind, Map<number, { digest: Hex; name: string }>>

export function collectionKind(value: string | undefined): CollectionKind | undefined {
	return COLLECTION_KINDS.find(candidate => candidate === value)
}

export function emptyCollectionFiles(): CollectionFiles {
	return Object.fromEntries(COLLECTION_KINDS.map(kind => [kind, new Map<number, { digest: Hex; name: string }>()])) as CollectionFiles
}

export function appendLoadedRecord(
	kind: CollectionKind,
	value: unknown,
	loaded: {
		pairsByPool: Record<string, unknown>
		poolDeployments: unknown[]
		questions: unknown[]
		universeChildren: Record<string, unknown>
		vaultCursors: Record<string, unknown>
		vaultsByPool: Record<string, unknown>
	},
) {
	if (kind === 'pool-deployments') {
		loaded.poolDeployments.push(value)
		return
	}
	if (kind === 'questions') {
		loaded.questions.push(value)
		return
	}
	const record = requiredRecord(value, `immutable topology ${kind} record`)
	if (kind === 'pairs') {
		assertExactKeys(record, ['pair', 'pool'], [], `immutable topology ${kind} record`)
		const pool = boundedString(record['pool'], 'immutable topology pair pool', 42)
		if (pool in loaded.pairsByPool) throw new Error(`Immutable topology pairs contain duplicate pool ${pool}`)
		loaded.pairsByPool[pool] = record['pair']
		return
	}
	if (kind === 'universe-children') {
		assertExactKeys(record, ['childUniverseIds', 'outcomeIndexes', 'universeId'], [], `immutable topology ${kind} record`)
		const universeId = unsignedIntegerString(record['universeId'], 'immutable topology universe-children universeId')
		if (universeId in loaded.universeChildren) throw new Error(`Immutable topology universe children contain duplicate universe ${universeId}`)
		loaded.universeChildren[universeId] = { childUniverseIds: record['childUniverseIds'], outcomeIndexes: record['outcomeIndexes'] }
		return
	}
	if (kind === 'vault-cursors') {
		assertExactKeys(record, ['cursor', 'pool'], [], `immutable topology ${kind} record`)
		const pool = boundedString(record['pool'], 'immutable topology vault-cursor pool', 42)
		if (pool in loaded.vaultCursors) throw new Error(`Immutable topology vault cursors contain duplicate pool ${pool}`)
		loaded.vaultCursors[pool] = record['cursor']
		return
	}
	assertExactKeys(record, ['pool', 'vaults'], [], `immutable topology ${kind} record`)
	const pool = boundedString(record['pool'], 'immutable topology vault-registry pool', 42)
	if (pool in loaded.vaultsByPool) throw new Error(`Immutable topology vault registries contain duplicate pool ${pool}`)
	loaded.vaultsByPool[pool] = record['vaults']
}

export function loadedRecordItemCount(kind: CollectionKind, value: unknown) {
	if (kind === 'pairs' || kind === 'pool-deployments' || kind === 'vault-cursors') return 1
	const record = requiredRecord(value, `immutable topology ${kind} record`)
	if (kind === 'questions') {
		const labels = record['outcomeLabels']
		if (!Array.isArray(labels)) throw new Error('Immutable topology question record outcomeLabels must be an array')
		return 1 + labels.length
	}
	if (kind === 'universe-children') {
		const childUniverseIds = record['childUniverseIds']
		const outcomeIndexes = record['outcomeIndexes']
		if (!Array.isArray(childUniverseIds) || !Array.isArray(outcomeIndexes)) throw new Error('Immutable topology universe-child record routes must be arrays')
		return 1 + childUniverseIds.length + outcomeIndexes.length
	}
	const vaults = record['vaults']
	if (!Array.isArray(vaults)) throw new Error('Immutable topology vault record vaults must be an array')
	return 1 + vaults.length
}

export function parseChunkRecords(contents: string, kind: CollectionKind, ordinal: number) {
	const chunk = requiredRecord(parseJsonDocument(contents, `Immutable topology ${kind} chunk ${ordinal.toString()}`), `immutable topology ${kind} chunk ${ordinal.toString()}`)
	assertExactKeys(chunk, ['kind', 'ordinal', 'records', 'schemaVersion'], [], `immutable topology ${kind} chunk ${ordinal.toString()}`)
	if (chunk['schemaVersion'] !== TOPOLOGY_CHUNK_SCHEMA_VERSION || chunk['kind'] !== kind || chunk['ordinal'] !== ordinal.toString()) throw new Error(`Immutable topology ${kind} chunk ${ordinal.toString()} identity is invalid`)
	if (!Array.isArray(chunk['records']) || chunk['records'].length === 0 || chunk['records'].length > TOPOLOGY_CHUNK_RECORDS) {
		throw new Error(`Immutable topology ${kind} chunk ${ordinal.toString()} must contain between 1 and ${TOPOLOGY_CHUNK_RECORDS.toString()} records`)
	}
	return chunk['records']
}
