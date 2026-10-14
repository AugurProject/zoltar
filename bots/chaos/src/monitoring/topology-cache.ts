import { randomUUID } from 'node:crypto'
import { mkdir, opendir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isExistingTargetError, ownerDirectory, ownerFilesystem, parseJsonDocument, readOwnerFile, syncOwnerDirectory, writeOwnerFile } from '@zoltar/bot-shared/config/durable-file'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'
import { type Hex } from '@zoltar/bot-shared/ethereum'

import { collectionDigest, manifestWithDigest, sha256 } from '../state/content-digest.ts'
import { requiredRecord } from '../state/validators.ts'
import {
	ImmutableTopologyIdentity,
	ImmutableTopologyResidentLimits,
	IMMUTABLE_TOPOLOGY_MANIFEST_BYTES,
	IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
	IMMUTABLE_TOPOLOGY_SEGMENT_BYTES,
	parseTopologyCache,
	assertTopologyResidentBounds,
	parseIdentity,
	CanonicalImmutableTopologyCache,
	IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES,
	validateImmutableTopologyCache,
	isConfiguredResidentLimitError,
} from './topology-schema.ts'
import {
	parseManifest,
	sameIdentity,
	assertManifestResidentBounds,
	emptyCollectionFiles,
	safeCount,
	COLLECTION_KINDS,
	collectionKind,
	parseChunkRecords,
	loadedRecordItemCount,
	appendLoadedRecord,
	collectionStatistics,
	parsePointer,
	CollectionKind,
	TopologyCollectionRecord,
	CollectionCommitment,
	TOPOLOGY_CHUNK_SCHEMA_VERSION,
	chunkFilename,
	TOPOLOGY_CHUNK_RECORDS,
	topologyCollectionRecords,
	manifestPayload,
	TOPOLOGY_POINTER_SCHEMA_VERSION,
	TopologyPointer,
} from './topology-format.ts'

const TOPOLOGY_STORE_MAXIMUM_ENTRIES = 256
const GENERATION_NAME = /^[0-9a-f]{64}$/
const TEMPORARY_GENERATION_NAME = /^\.tmp-[0-9]+-[0-9a-f-]+$/
const TEMPORARY_POINTER_NAME = /^\.current-[0-9]+-[0-9a-f-]+\.json$/
const CHUNK_FILE = /^(pairs|pool-deployments|questions|universe-children|vault-cursors|vaults)-(0|[1-9]\d*)-([0-9a-f]{64})\.json$/

function immutableTopologySidecarDirectory(statePath: string) {
	return `${resolve(statePath)}.immutable-topology-v1`
}

function generationDirectory(statePath: string, digest: Hex) {
	return `${immutableTopologySidecarDirectory(statePath)}/${digest.slice(2)}`
}

async function loadGeneration(statePath: string, digest: Hex, expectedIdentity: ImmutableTopologyIdentity, limits?: ImmutableTopologyResidentLimits) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	const generationPath = generationDirectory(statePath, digest)
	await ownerDirectory(storePath, ownerFilesystem, 'Immutable topology store')
	await ownerDirectory(generationPath, ownerFilesystem, 'Immutable topology generation')
	const rawManifest = parseJsonDocument(await readOwnerFile(`${generationPath}/manifest.json`, ownerFilesystem, 'Immutable topology manifest', IMMUTABLE_TOPOLOGY_MANIFEST_BYTES), 'Immutable topology manifest')
	const manifestRecord = requiredRecord(rawManifest, 'immutable topology manifest')
	// Older payloads retained unbounded registries or possibly truncated labels.
	// Discard them before reading any committed payload into the process.
	if (manifestRecord['payloadSchemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION) return undefined
	const manifest = parseManifest(manifestRecord, digest)
	if (!sameIdentity(manifest.identity, expectedIdentity)) return undefined
	assertManifestResidentBounds(manifest, limits)
	const files = emptyCollectionFiles()
	let foundManifest = false
	const maximumEntries = safeCount((1n + COLLECTION_KINDS.reduce((total, kind) => total + BigInt(manifest.collections[kind].chunkCount), 0n)).toString(), 'Immutable topology generation entry limit')
	let entryCount = 0
	for await (const entry of await opendir(generationPath)) {
		entryCount += 1
		if (entryCount > maximumEntries) throw new Error(`Immutable topology generation exceeds its manifest-declared ${maximumEntries.toString()}-entry safety limit`)
		if (entry.name === 'manifest.json') {
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Immutable topology manifest must be a regular non-symbolic-link file')
			foundManifest = true
			continue
		}
		const match = CHUNK_FILE.exec(entry.name)
		if (match === null || !entry.isFile() || entry.isSymbolicLink()) throw new Error(`Immutable topology generation contains unsupported entry ${entry.name}`)
		const kind = collectionKind(match[1])
		const ordinalText = match[2]
		const digestText = match[3]
		if (kind === undefined || ordinalText === undefined || digestText === undefined) throw new Error(`Immutable topology chunk ${entry.name} has an invalid identity`)
		const ordinal = safeCount(ordinalText, `Immutable topology chunk ${entry.name} ordinal`)
		if (files[kind].has(ordinal)) throw new Error(`Immutable topology generation contains duplicate ${kind} chunk ordinal ${ordinal.toString()}`)
		files[kind].set(ordinal, { digest: `0x${digestText}` as Hex, name: entry.name })
	}
	if (!foundManifest) throw new Error('Immutable topology generation is missing its manifest')
	const loaded = { pairsByPool: {}, poolDeployments: [], questions: [], universeChildren: {}, vaultCursors: {}, vaultsByPool: {} } as {
		pairsByPool: Record<string, unknown>
		poolDeployments: unknown[]
		questions: unknown[]
		universeChildren: Record<string, unknown>
		vaultCursors: Record<string, unknown>
		vaultsByPool: Record<string, unknown>
	}
	for (const kind of COLLECTION_KINDS) {
		const commitment = manifest.collections[kind]
		const expectedChunks = safeCount(commitment.chunkCount, `Immutable topology ${kind} chunk count`)
		if (files[kind].size !== expectedChunks) throw new Error(`Immutable topology ${kind} collection is missing or has extra chunks`)
		const digests: Hex[] = []
		let committedBytes = 0n
		let itemCount = 0n
		let recordCount = 0n
		for (let ordinal = 0; ordinal < expectedChunks; ordinal += 1) {
			const file = files[kind].get(ordinal)
			if (file === undefined) throw new Error(`Immutable topology ${kind} collection is missing chunk ${ordinal.toString()}`)
			const contents = await readOwnerFile(`${generationPath}/${file.name}`, ownerFilesystem, `Immutable topology ${kind} chunk`, IMMUTABLE_TOPOLOGY_SEGMENT_BYTES)
			const actualDigest = sha256(contents)
			if (actualDigest !== file.digest) throw new Error(`Immutable topology ${kind} chunk ${ordinal.toString()} digest does not match its immutable filename`)
			const nextCommittedBytes = committedBytes + BigInt(Buffer.byteLength(contents, 'utf8'))
			if (nextCommittedBytes > BigInt(commitment.committedBytes)) throw new Error(`Immutable topology ${kind} collection committed bytes exceed its manifest commitment`)
			const records = parseChunkRecords(contents, kind, ordinal)
			const nextRecordCount = recordCount + BigInt(records.length)
			if (nextRecordCount > BigInt(commitment.recordCount)) throw new Error(`Immutable topology ${kind} collection record count exceeds its manifest commitment`)
			let nextItemCount = itemCount
			for (const record of records) nextItemCount += BigInt(loadedRecordItemCount(kind, record))
			if (nextItemCount > BigInt(commitment.itemCount)) throw new Error(`Immutable topology ${kind} collection resident-item count exceeds its manifest commitment`)
			for (const record of records) {
				appendLoadedRecord(kind, record, loaded)
			}
			digests.push(actualDigest)
			committedBytes = nextCommittedBytes
			itemCount = nextItemCount
			recordCount = nextRecordCount
		}
		if (recordCount.toString() !== commitment.recordCount || itemCount.toString() !== commitment.itemCount || committedBytes.toString() !== commitment.committedBytes) {
			throw new Error(`Immutable topology ${kind} collection totals do not match its manifest`)
		}
		if (collectionDigest(digests) !== commitment.chunksDigest) throw new Error(`Immutable topology ${kind} chunk-root digest does not match its manifest`)
	}
	const cache = parseTopologyCache({
		anchor: manifest.anchor,
		discoveryCursors: { ...manifest.discoveryCursors, vaultsByPool: loaded.vaultCursors },
		pairsByPool: loaded.pairsByPool,
		poolDeployments: loaded.poolDeployments,
		questions: loaded.questions,
		schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		universeChildren: loaded.universeChildren,
		vaultsByPool: loaded.vaultsByPool,
	})
	assertTopologyResidentBounds(cache, limits)
	for (const kind of COLLECTION_KINDS) {
		const statistics = collectionStatistics(cache, kind)
		const commitment = manifest.collections[kind]
		if (statistics.itemCount !== commitment.itemCount || statistics.recordCount !== commitment.recordCount) throw new Error(`Immutable topology ${kind} resident totals do not match its manifest`)
	}
	return cache
}

async function loadImmutableTopologyCache(statePath: string, expectedIdentity: ImmutableTopologyIdentity, limits?: ImmutableTopologyResidentLimits) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	try {
		await ownerDirectory(storePath, ownerFilesystem, 'Immutable topology store')
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return undefined
		throw error
	}
	let pointerContents: string
	try {
		pointerContents = await readOwnerFile(`${storePath}/current.json`, ownerFilesystem, 'Immutable topology pointer', IMMUTABLE_TOPOLOGY_MANIFEST_BYTES)
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return undefined
		throw error
	}
	const pointer = parsePointer(parseJsonDocument(pointerContents, 'Immutable topology pointer'))
	return await loadGeneration(statePath, pointer.manifestDigest, parseIdentity(expectedIdentity, 'expected immutable topology identity'), limits)
}

/** Authenticates compatible topology, or reports the same rebuild decision as the scanner, without mutating state. */
export async function validateImmutableTopologySidecarIfPresent(statePath: string, expectedIdentity: ImmutableTopologyIdentity, limits?: ImmutableTopologyResidentLimits) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	try {
		await ownerDirectory(storePath, ownerFilesystem, 'Immutable topology store')
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return 'absent' as const
		throw error
	}
	let pointerContents: string
	try {
		pointerContents = await readOwnerFile(`${storePath}/current.json`, ownerFilesystem, 'Immutable topology pointer', IMMUTABLE_TOPOLOGY_MANIFEST_BYTES)
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return 'absent' as const
		throw error
	}
	const pointer = parsePointer(parseJsonDocument(pointerContents, 'Immutable topology pointer'))
	const loaded = await loadGeneration(statePath, pointer.manifestDigest, parseIdentity(expectedIdentity, 'expected immutable topology identity'), limits)
	return loaded === undefined ? ('rebuild-required' as const) : ('valid' as const)
}

async function currentGenerationName(storePath: string) {
	try {
		const pointer = parsePointer(parseJsonDocument(await readOwnerFile(`${storePath}/current.json`, ownerFilesystem, 'Immutable topology pointer', IMMUTABLE_TOPOLOGY_MANIFEST_BYTES), 'Immutable topology pointer'))
		return pointer.manifestDigest.slice(2)
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return undefined
		throw error
	}
}

async function pruneGenerations(storePath: string, retainedGeneration: string | undefined) {
	let entryCount = 0
	let incomplete = false
	for await (const entry of await opendir(storePath)) {
		if (entryCount >= TOPOLOGY_STORE_MAXIMUM_ENTRIES) {
			incomplete = true
			break
		}
		entryCount += 1
		if (entry.name === 'current.json' || entry.name === retainedGeneration) continue
		if (!GENERATION_NAME.test(entry.name) && !TEMPORARY_GENERATION_NAME.test(entry.name) && !TEMPORARY_POINTER_NAME.test(entry.name)) continue
		await rm(`${storePath}/${entry.name}`, { force: true, recursive: true })
	}
	await syncOwnerDirectory(storePath, ownerFilesystem)
	return !incomplete
}

async function writeCollection(path: string, kind: CollectionKind, source: Iterable<TopologyCollectionRecord>, budget: { remainingBytes: bigint }): Promise<CollectionCommitment> {
	const digests: Hex[] = []
	let committedBytes = 0n
	let itemCount = 0n
	let recordCount = 0n
	let records: string[] = []
	const contents = () => `{"kind":${JSON.stringify(kind)},"ordinal":${JSON.stringify(digests.length.toString())},"records":[${records.join(',')}],"schemaVersion":${TOPOLOGY_CHUNK_SCHEMA_VERSION.toString()}}\n`
	const flush = async () => {
		if (records.length === 0) return
		const chunk = contents()
		const byteLength = Buffer.byteLength(chunk, 'utf8')
		if (byteLength > IMMUTABLE_TOPOLOGY_SEGMENT_BYTES) throw new Error(`Immutable topology ${kind} chunk exceeds its ${IMMUTABLE_TOPOLOGY_SEGMENT_BYTES.toString()}-byte safety limit`)
		if (BigInt(byteLength) > budget.remainingBytes) throw new Error('Immutable topology cache exceeds its aggregate committed-byte safety limit')
		const digest = sha256(chunk)
		await writeOwnerFile(`${path}/${chunkFilename(kind, digests.length, digest)}`, chunk, ownerFilesystem)
		digests.push(digest)
		committedBytes += BigInt(byteLength)
		budget.remainingBytes -= BigInt(byteLength)
		records = []
	}
	for (const record of source) {
		const encoded = JSON.stringify(record.value)
		if (encoded === undefined) throw new Error(`Immutable topology ${kind} record is not JSON serializable`)
		records.push(encoded)
		if (records.length > TOPOLOGY_CHUNK_RECORDS || Buffer.byteLength(contents(), 'utf8') > IMMUTABLE_TOPOLOGY_SEGMENT_BYTES) {
			records.pop()
			await flush()
			records.push(encoded)
			if (Buffer.byteLength(contents(), 'utf8') > IMMUTABLE_TOPOLOGY_SEGMENT_BYTES) throw new Error(`Immutable topology ${kind} record exceeds its chunk safety limit`)
		}
		itemCount += BigInt(record.items)
		recordCount += 1n
		if (records.length === TOPOLOGY_CHUNK_RECORDS) await flush()
	}
	await flush()
	return {
		chunkCount: digests.length.toString(),
		chunksDigest: collectionDigest(digests),
		committedBytes: committedBytes.toString(),
		itemCount: itemCount.toString(),
		recordCount: recordCount.toString(),
	}
}

export async function saveImmutableTopologyCache(statePath: string, identity: ImmutableTopologyIdentity, value: CanonicalImmutableTopologyCache, limits?: ImmutableTopologyResidentLimits) {
	const parsedIdentity = parseIdentity(identity, 'immutable topology identity')
	const cache = parseTopologyCache(value)
	assertTopologyResidentBounds(cache, limits)
	const storePath = immutableTopologySidecarDirectory(statePath)
	await mkdir(storePath, { mode: 0o700, recursive: true })
	await ownerDirectory(storePath, ownerFilesystem, 'Immutable topology store')
	if (!(await pruneGenerations(storePath, await currentGenerationName(storePath)))) {
		throw new Error(`Immutable topology store cleanup reached its ${TOPOLOGY_STORE_MAXIMUM_ENTRIES.toString()}-entry per-cycle safety limit; retry to continue bounded cleanup`)
	}
	const temporaryPath = `${storePath}/.tmp-${process.pid.toString()}-${randomUUID()}`
	await mkdir(temporaryPath, { mode: 0o700 })
	await ownerDirectory(temporaryPath, ownerFilesystem, 'Temporary immutable topology generation')
	let renamedGeneration = false
	try {
		const budget = { remainingBytes: BigInt(IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES) }
		const collections: Record<CollectionKind, CollectionCommitment> = {
			pairs: await writeCollection(temporaryPath, 'pairs', topologyCollectionRecords(cache, 'pairs'), budget),
			'pool-deployments': await writeCollection(temporaryPath, 'pool-deployments', topologyCollectionRecords(cache, 'pool-deployments'), budget),
			questions: await writeCollection(temporaryPath, 'questions', topologyCollectionRecords(cache, 'questions'), budget),
			'universe-children': await writeCollection(temporaryPath, 'universe-children', topologyCollectionRecords(cache, 'universe-children'), budget),
			'vault-cursors': await writeCollection(temporaryPath, 'vault-cursors', topologyCollectionRecords(cache, 'vault-cursors'), budget),
			vaults: await writeCollection(temporaryPath, 'vaults', topologyCollectionRecords(cache, 'vaults'), budget),
		}
		const totalCommittedBytes = COLLECTION_KINDS.reduce((total, kind) => total + BigInt(collections[kind].committedBytes), 0n)
		if (totalCommittedBytes > BigInt(IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES)) throw new Error('Immutable topology cache exceeds its aggregate committed-byte safety limit')
		const manifest = manifestWithDigest(
			manifestPayload({
				anchor: { ...cache.anchor },
				collections,
				discoveryCursors: {
					poolDeployments: { ...cache.discoveryCursors.poolDeployments },
					questions: { ...cache.discoveryCursors.questions },
				},
				identity: parsedIdentity,
			}),
		)
		const manifestContents = `${JSON.stringify(manifest)}\n`
		if (Buffer.byteLength(manifestContents, 'utf8') > IMMUTABLE_TOPOLOGY_MANIFEST_BYTES) throw new Error('Immutable topology manifest exceeds its fixed safety envelope')
		await writeOwnerFile(`${temporaryPath}/manifest.json`, manifestContents, ownerFilesystem)
		await syncOwnerDirectory(temporaryPath, ownerFilesystem)
		const generationName = manifest.manifestDigest.slice(2)
		const targetPath = `${storePath}/${generationName}`
		try {
			await rename(temporaryPath, targetPath)
			renamedGeneration = true
			await syncOwnerDirectory(storePath, ownerFilesystem)
		} catch (error) {
			if (!isExistingTargetError(error)) throw error
			await rm(temporaryPath, { force: true, recursive: true })
		}
		await loadGeneration(statePath, manifest.manifestDigest, parsedIdentity, limits)
		const pointerPath = `${storePath}/current.json`
		const temporaryPointerPath = `${storePath}/.current-${process.pid.toString()}-${randomUUID()}.json`
		await writeOwnerFile(temporaryPointerPath, `${JSON.stringify({ manifestDigest: manifest.manifestDigest, schemaVersion: TOPOLOGY_POINTER_SCHEMA_VERSION } satisfies TopologyPointer)}\n`, ownerFilesystem)
		try {
			await rename(temporaryPointerPath, pointerPath)
		} catch (error) {
			await rm(temporaryPointerPath, { force: true })
			throw error
		}
		await syncOwnerDirectory(storePath, ownerFilesystem)
		if (!(await pruneGenerations(storePath, generationName))) throw new Error(`Immutable topology store cleanup reached its ${TOPOLOGY_STORE_MAXIMUM_ENTRIES.toString()}-entry per-cycle safety limit`)
	} catch (error) {
		if (!renamedGeneration) await rm(temporaryPath, { force: true, recursive: true })
		throw error
	}
}

export async function loadImmutableTopologyCacheWithinLimits(parameters: { identity: ImmutableTopologyIdentity; limits: ImmutableTopologyResidentLimits; previous?: CanonicalImmutableTopologyCache; statePath: string }) {
	try {
		return parameters.previous === undefined ? await loadImmutableTopologyCache(parameters.statePath, parameters.identity, parameters.limits) : validateImmutableTopologyCache(parameters.previous, parameters.limits)
	} catch (error) {
		if (!isConfiguredResidentLimitError(error)) throw error
		return undefined
	}
}
