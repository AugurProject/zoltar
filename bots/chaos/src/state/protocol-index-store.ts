import { manifestWithDigest, sha256 } from './content-digest.ts'
import { isExistingTargetError, ownerDirectory, parseJsonDocument, readOwnerFile, syncOwnerDirectory, writeOwnerFile, type OwnerFileHandle } from '@zoltar/bot-shared/config/durable-file'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'
import { getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '#monitoring/protocol-index'

import {
	ProtocolIndexReference,
	CollectionKind,
	PreparedProtocolIndexCollection,
	ProtocolIndexPreparationBudget,
	prepareCollection,
	CollectionCommitment,
	validateManifestEnvelope,
	MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES,
	MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES,
	parseManifest,
	emptyLoadedCollections,
	COLLECTION_KINDS,
	safeCount,
	chunkFilename,
	MAXIMUM_PROTOCOL_INDEX_BYTES,
	parseChunkEnvelope,
	MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS,
	appendParsedRecord,
	validateLoadedCollectionOrder,
	manifestPayload,
	PROTOCOL_INDEX_REFERENCE_VERSION,
	isReference,
	parseProtocolIndexReference,
} from './protocol-index-format.ts'
import { isValidatedProtocolIndex, parseProtocolIndex, immutableProtocolIndex, AuctionBidRecord, AuctionRefundRecord, auctionBidRecord, auctionRefundRecord, ProtocolIndexIdentity } from './protocol-index-schema.ts'

const GENERATION_NAME = /^[0-9a-f]{64}$/
const TEMPORARY_GENERATION_NAME = /^\.tmp-[0-9]+-[0-9a-f-]+$/
const persistedReferences = new WeakMap<ChaosProtocolIndex, Map<string, ProtocolIndexReference>>()
const latestPersistedReferences = new Map<string, ProtocolIndexReference>()

type ProtocolIndexDirectoryEntry = {
	isDirectory: () => boolean
	isFile: () => boolean
	isSymbolicLink: () => boolean
	name: string
}

export type ProtocolIndexFilesystem = {
	link: (existingPath: string, newPath: string) => Promise<unknown>
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx' | number, mode?: number) => Promise<OwnerFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	readdir: (path: string, options: { withFileTypes: true }) => Promise<ProtocolIndexDirectoryEntry[]>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true; recursive?: true }) => Promise<unknown>
}

function rememberedReference(index: ChaosProtocolIndex, statePath: string) {
	return persistedReferences.get(index)?.get(resolve(statePath))
}

function rememberReference(index: ChaosProtocolIndex, statePath: string, reference: ProtocolIndexReference) {
	const resolvedStatePath = resolve(statePath)
	const references = persistedReferences.get(index) ?? new Map<string, ProtocolIndexReference>()
	references.set(resolvedStatePath, reference)
	persistedReferences.set(index, references)
	latestPersistedReferences.set(resolvedStatePath, reference)
}

export function snapshotProtocolIndex(index: ChaosProtocolIndex, expectedChainId: number) {
	const snapshot = isValidatedProtocolIndex(index) ? index : parseProtocolIndex(index, expectedChainId)
	if (snapshot === undefined) throw new Error('Cannot snapshot an absent protocol index')
	const immutable = isValidatedProtocolIndex(snapshot) ? snapshot : immutableProtocolIndex(snapshot)
	prepareProtocolIndexCollections(immutable)
	return immutable
}

function protocolIndexSidecarDirectory(statePath: string) {
	return `${resolve(statePath)}.protocol-index-v1`
}

function generationDirectory(statePath: string, manifestDigest: Hex) {
	return `${protocolIndexSidecarDirectory(statePath)}/${manifestDigest.slice(2)}`
}

export type PreparedProtocolIndexChunk = {
	contents: string
	digest: Hex
	filename: string
}

type PreparedProtocolIndexCollections = Record<CollectionKind, PreparedProtocolIndexCollection>

const preparedProtocolIndexes = new WeakMap<ChaosProtocolIndex, PreparedProtocolIndexCollections>()

function prepareProtocolIndexCollections(index: ChaosProtocolIndex) {
	const cached = preparedProtocolIndexes.get(index)
	if (cached !== undefined) return cached
	const budget: ProtocolIndexPreparationBudget = { bytes: 0, chunks: 0, records: 0 }
	const prepared: PreparedProtocolIndexCollections = {
		'auction-bids': prepareCollection('auction-bids', auctionBidRecords(index), budget),
		'auction-refunds': prepareCollection('auction-refunds', auctionRefundRecords(index), budget),
		'child-routes': prepareCollection('child-routes', index.childRepSplits, budget),
		'escalation-deposits': prepareCollection('escalation-deposits', index.escalationDeposits, budget),
		'migration-routes': prepareCollection('migration-routes', index.migrationRepSplits, budget),
		reports: prepareCollection('reports', index.reports, budget),
	}
	const commitments: Record<CollectionKind, CollectionCommitment> = {
		'auction-bids': prepared['auction-bids'].commitment,
		'auction-refunds': prepared['auction-refunds'].commitment,
		'child-routes': prepared['child-routes'].commitment,
		'escalation-deposits': prepared['escalation-deposits'].commitment,
		'migration-routes': prepared['migration-routes'].commitment,
		reports: prepared.reports.commitment,
	}
	validateManifestEnvelope(commitments)
	preparedProtocolIndexes.set(index, prepared)
	return prepared
}

function canFallBackFromLink(error: unknown) {
	return isErrorCode(error, 'ENOENT', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV')
}

async function writePreparedCollection(path: string, previousPath: string | undefined, prepared: PreparedProtocolIndexCollection, filesystem: ProtocolIndexFilesystem) {
	for (const chunk of prepared.chunks) {
		const destination = `${path}/${chunk.filename}`
		if (previousPath !== undefined) {
			let linked = false
			try {
				await filesystem.link(`${previousPath}/${chunk.filename}`, destination)
				linked = true
				const linkedContents = await readOwnerFile(destination, filesystem, 'Linked protocol index chunk', MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES)
				if (linkedContents !== chunk.contents || sha256(linkedContents) !== chunk.digest) throw new Error(`Linked protocol index chunk ${chunk.filename} does not match its prepared immutable content`)
				continue
			} catch (error) {
				if (linked) await filesystem.rm(destination, { force: true })
				else if (!canFallBackFromLink(error)) throw error
			}
		}
		await writeOwnerFile(destination, chunk.contents, filesystem)
	}
}

function* auctionBidRecords(index: ChaosProtocolIndex): Generator<AuctionBidRecord> {
	for (const [auction, bids] of Object.entries(index.auctionBids)) {
		for (const bid of bids) yield { auction: getAddress(auction), bid }
	}
	return
}

function* auctionRefundRecords(index: ChaosProtocolIndex): Generator<AuctionRefundRecord> {
	for (const [auction, refund] of Object.entries(index.auctionRefunds)) {
		yield { auction: getAddress(auction), refund }
	}
	return
}

async function loadProtocolIndexGeneration(statePath: string, reference: ProtocolIndexReference, expectedChainId: number, filesystem: ProtocolIndexFilesystem): Promise<ChaosProtocolIndex> {
	const storePath = protocolIndexSidecarDirectory(statePath)
	const generationPath = generationDirectory(statePath, reference.manifestDigest)
	await ownerDirectory(storePath, filesystem, 'Protocol index store')
	await ownerDirectory(generationPath, filesystem, 'Protocol index generation')
	const manifestContents = await readOwnerFile(`${generationPath}/manifest.json`, filesystem, 'Protocol index manifest', MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES)
	const manifest = parseManifest(parseJsonDocument(manifestContents, 'Protocol index manifest'), expectedChainId, reference.manifestDigest)
	const loaded = emptyLoadedCollections()
	let loadedBytes = 0
	for (const kind of COLLECTION_KINDS) {
		const commitment = manifest.collections[kind]
		const expectedChunkCount = safeCount(commitment.chunkCount, `Protocol index ${kind} chunk count`)
		let parsedByteCount = 0n
		let parsedRecordCount = 0n
		for (let ordinal = 0; ordinal < expectedChunkCount; ordinal += 1) {
			const digest = commitment.chunkDigests[ordinal]
			if (digest === undefined) throw new Error(`Protocol index ${kind} collection is missing chunk ${ordinal.toString()}`)
			let contents: string
			try {
				contents = await readOwnerFile(`${generationPath}/${chunkFilename(kind, ordinal, digest)}`, filesystem, 'Protocol index chunk', MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES)
			} catch (error) {
				if (isErrorCode(error, 'ENOENT')) throw new Error(`Protocol index ${kind} collection is missing chunk ${ordinal.toString()}`)
				throw error
			}
			const actualDigest = sha256(contents)
			if (actualDigest !== digest) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} digest does not match its immutable filename`)
			const contentsBytes = Buffer.byteLength(contents, 'utf8')
			loadedBytes += contentsBytes
			if (loadedBytes > MAXIMUM_PROTOCOL_INDEX_BYTES) throw new Error(`Protocol index exceeds the ${MAXIMUM_PROTOCOL_INDEX_BYTES.toString()}-byte aggregate safety limit`)
			parsedByteCount += BigInt(contentsBytes)
			const records = parseChunkEnvelope(contents, kind, ordinal)
			if (ordinal + 1 < expectedChunkCount && records.length !== MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) throw new Error(`Protocol index ${kind} chunk ${ordinal.toString()} is not a complete canonical chunk`)
			for (let index = 0; index < records.length; index += 1) {
				appendParsedRecord(loaded, kind, records[index], manifest.identity, `protocolIndex.${kind}[${parsedRecordCount.toString()}]`)
				parsedRecordCount += 1n
			}
		}
		if (parsedByteCount.toString() !== commitment.byteCount) throw new Error(`Protocol index ${kind} byte count does not match its manifest`)
		if (parsedRecordCount.toString() !== commitment.recordCount) throw new Error(`Protocol index ${kind} record count does not match its manifest`)
	}
	validateLoadedCollectionOrder(loaded)
	const index = immutableProtocolIndex({
		...manifest.identity,
		auctionBids: auctionBidRecord(loaded.auctionBids),
		auctionRefunds: auctionRefundRecord(loaded.auctionRefunds),
		childRepSplits: loaded.childRepSplits,
		escalationDeposits: loaded.escalationDeposits,
		migrationRepSplits: loaded.migrationRepSplits,
		reports: loaded.reports,
	})
	rememberReference(index, statePath, reference)
	return index
}

async function validateCachedGeneration(statePath: string, reference: ProtocolIndexReference, expectedChainId: number, filesystem: ProtocolIndexFilesystem) {
	await loadProtocolIndexGeneration(statePath, reference, expectedChainId, filesystem)
}

export async function persistProtocolIndexGeneration(statePath: string, index: ChaosProtocolIndex, filesystem: ProtocolIndexFilesystem): Promise<ProtocolIndexReference> {
	const cachedReference = rememberedReference(index, statePath)
	if (cachedReference !== undefined) {
		try {
			await validateCachedGeneration(statePath, cachedReference, index.chainId, filesystem)
			return cachedReference
		} catch (error) {
			if (!isErrorCode(error, 'ENOENT')) throw error
			persistedReferences.get(index)?.delete(resolve(statePath))
			if (latestPersistedReferences.get(resolve(statePath))?.manifestDigest === cachedReference.manifestDigest) latestPersistedReferences.delete(resolve(statePath))
		}
	}
	const parsed = snapshotProtocolIndex(index, index.chainId)
	const preparedCollections = prepareProtocolIndexCollections(parsed)
	const collections: Record<CollectionKind, CollectionCommitment> = {
		'auction-bids': preparedCollections['auction-bids'].commitment,
		'auction-refunds': preparedCollections['auction-refunds'].commitment,
		'child-routes': preparedCollections['child-routes'].commitment,
		'escalation-deposits': preparedCollections['escalation-deposits'].commitment,
		'migration-routes': preparedCollections['migration-routes'].commitment,
		reports: preparedCollections.reports.commitment,
	}
	const identity: ProtocolIndexIdentity = {
		chainId: parsed.chainId,
		cursor: parsed.cursor,
		openOracle: parsed.openOracle,
		schemaVersion: 3,
		securityPoolForker: parsed.securityPoolForker,
		startBlock: parsed.startBlock,
		...(parsed.availableStartBlock === undefined ? {} : { availableStartBlock: parsed.availableStartBlock }),
		wallet: parsed.wallet,
		zoltar: parsed.zoltar,
	}
	const manifest = manifestWithDigest(manifestPayload(identity, collections))
	const manifestContents = `${JSON.stringify(manifest)}\n`
	if (Buffer.byteLength(manifestContents, 'utf8') > MAXIMUM_PROTOCOL_INDEX_MANIFEST_BYTES) throw new Error('Protocol index manifest exceeds its fixed safety envelope')
	const reference: ProtocolIndexReference = { kind: 'protocol-index-sidecar', manifestDigest: manifest.manifestDigest, schemaVersion: PROTOCOL_INDEX_REFERENCE_VERSION }
	const targetPath = generationDirectory(statePath, reference.manifestDigest)
	const storePath = protocolIndexSidecarDirectory(statePath)
	const previousReference = latestPersistedReferences.get(resolve(statePath))
	const previousGenerationPath = previousReference === undefined ? undefined : generationDirectory(statePath, previousReference.manifestDigest)
	await filesystem.mkdir(storePath, { mode: 0o700, recursive: true })
	await ownerDirectory(storePath, filesystem, 'Protocol index store')
	const temporaryPath = `${storePath}/.tmp-${process.pid.toString()}-${randomUUID()}`
	await filesystem.mkdir(temporaryPath, { mode: 0o700, recursive: true })
	await ownerDirectory(temporaryPath, filesystem, 'Temporary protocol index generation')
	let renamed = false
	try {
		for (const kind of COLLECTION_KINDS) await writePreparedCollection(temporaryPath, previousGenerationPath, preparedCollections[kind], filesystem)
		await writeOwnerFile(`${temporaryPath}/manifest.json`, manifestContents, filesystem)
		await syncOwnerDirectory(temporaryPath, filesystem)
		try {
			await filesystem.rename(temporaryPath, targetPath)
			renamed = true
			await syncOwnerDirectory(storePath, filesystem)
		} catch (error) {
			if (!isExistingTargetError(error)) throw error
			await filesystem.rm(temporaryPath, { force: true, recursive: true })
		}
		await loadProtocolIndexGeneration(statePath, reference, parsed.chainId, filesystem)
		rememberReference(parsed, statePath, reference)
		preparedProtocolIndexes.delete(parsed)
		return reference
	} catch (error) {
		if (renamed) {
			await filesystem.rm(targetPath, { force: true, recursive: true })
			await syncOwnerDirectory(storePath, filesystem)
		} else {
			await filesystem.rm(temporaryPath, { force: true, recursive: true })
		}
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
		if (isErrorCode(error, 'ENOENT')) return
		throw error
	}
	const retainedName = retainedReference?.manifestDigest.slice(2)
	const entries = await filesystem.readdir(storePath, { withFileTypes: true })
	for (const entry of entries) {
		if (entry.name === retainedName) continue
		if (!GENERATION_NAME.test(entry.name) && !TEMPORARY_GENERATION_NAME.test(entry.name)) continue
		await filesystem.rm(`${storePath}/${entry.name}`, { force: true, recursive: true })
	}
	await syncOwnerDirectory(storePath, filesystem)
}
