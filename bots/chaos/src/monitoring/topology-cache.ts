import { constants as bufferConstants } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getAddress, zeroAddress, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import type { QuestionSnapshot } from '../operations/types.ts'

export const IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION = 1
export const IMMUTABLE_TOPOLOGY_SEGMENT_BYTES = 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MANIFEST_BYTES = 64 * 1024

const TOPOLOGY_STORE_SCHEMA_VERSION = 1
const TOPOLOGY_MANIFEST_SCHEMA_VERSION = 1
const TOPOLOGY_POINTER_SCHEMA_VERSION = 1
const GENERATION_NAME = /^[0-9a-f]{64}$/
const TEMPORARY_GENERATION_NAME = /^\.tmp-[0-9]+-[0-9a-f-]+$/
const TEMPORARY_POINTER_NAME = /^\.current-[0-9]+-[0-9a-f-]+\.json$/
const SEGMENT_FILE = /^segment-(0|[1-9]\d*)-([0-9a-f]{64})\.bin$/
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/

export interface ImmutableTopologyIdentity {
	chainId: number
	openOracle: Address
	questionData: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	tradingFactory: Address
	tradingRouter: Address
	weth: Address
	zoltar: Address
}

export interface CachedPoolDeployment {
	coordinator: Address
	parent: Address
	questionId: string
	securityPool: Address
	shareToken: Address
	truthAuction: Address
	universeId: string
}

export interface CachedUniverseChildren {
	childUniverseIds: string[]
	outcomeIndexes: string[]
}

export interface ImmutableTopologyData {
	pairsByPool: Record<string, Address>
	poolDeployments: CachedPoolDeployment[]
	questions: QuestionSnapshot[]
	universeChildren: Record<string, CachedUniverseChildren>
	vaultsByPool: Record<string, Address[]>
}

export interface CanonicalImmutableTopologyCache extends ImmutableTopologyData {
	anchor: {
		blockHash: Hash
		blockNumber: string
	}
	schemaVersion: typeof IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION
}

export function emptyImmutableTopologyData(): ImmutableTopologyData {
	return {
		pairsByPool: {},
		poolDeployments: [],
		questions: [],
		universeChildren: {},
		vaultsByPool: {},
	}
}

export function cloneImmutableTopologyData(cache: ImmutableTopologyData): ImmutableTopologyData {
	return {
		pairsByPool: { ...cache.pairsByPool },
		poolDeployments: cache.poolDeployments.map(deployment => ({ ...deployment })),
		questions: cache.questions.map(question => ({ ...question, outcomeLabels: [...question.outcomeLabels] })),
		universeChildren: Object.fromEntries(Object.entries(cache.universeChildren).map(([universeId, children]) => [universeId, { childUniverseIds: [...children.childUniverseIds], outcomeIndexes: [...children.outcomeIndexes] }])),
		vaultsByPool: Object.fromEntries(Object.entries(cache.vaultsByPool).map(([pool, vaults]) => [pool, [...vaults]])),
	}
}

type TopologyManifestPayload = {
	anchor: CanonicalImmutableTopologyCache['anchor']
	identity: ImmutableTopologyIdentity
	manifestSchemaVersion: 1
	payloadBytes: string
	payloadDigest: Hex
	payloadSchemaVersion: 1
	segmentCount: string
	segmentsDigest: Hex
	storeSchemaVersion: 1
}

type TopologyManifest = TopologyManifestPayload & {
	manifestDigest: Hex
}

type TopologyPointer = {
	manifestDigest: Hex
	schemaVersion: 1
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, required: readonly string[], label: string) {
	const expected = new Set(required)
	const unknown = Object.keys(record).filter(key => !expected.has(key))
	const missing = required.filter(key => !(key in record))
	if (unknown.length > 0) throw new Error(`${label} contains unsupported field ${unknown[0] ?? 'unknown'}`)
	if (missing.length > 0) throw new Error(`${label} is missing ${missing[0] ?? 'a required field'}`)
}

function unsignedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) throw new Error(`${label} must be a canonical unsigned integer string`)
	if (BigInt(value) >= 1n << 256n) throw new Error(`${label} exceeds uint256`)
	return value
}

function boundedString(value: unknown, label: string, maximumLength: number) {
	if (typeof value !== 'string' || value.length > maximumLength) throw new Error(`${label} must be a string of at most ${maximumLength.toString()} characters`)
	return value
}

function address(value: unknown, label: string) {
	if (typeof value !== 'string') throw new Error(`${label} must be an address`)
	try {
		return getAddress(value)
	} catch (error) {
		throw new Error(`${label} must be an address`, { cause: error })
	}
}

function hash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hash`)
	return value.toLowerCase() as Hash
}

function parseIdentity(value: unknown, label: string): ImmutableTopologyIdentity {
	const identity = requiredRecord(value, label)
	const addressFields = ['openOracle', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'tradingFactory', 'tradingRouter', 'weth', 'zoltar'] as const
	assertExactKeys(identity, ['chainId', ...addressFields], label)
	if (typeof identity['chainId'] !== 'number' || !Number.isSafeInteger(identity['chainId']) || identity['chainId'] <= 0) throw new Error(`${label}.chainId must be a positive safe integer`)
	return {
		chainId: identity['chainId'],
		openOracle: address(identity['openOracle'], `${label}.openOracle`),
		questionData: address(identity['questionData'], `${label}.questionData`),
		securityPoolFactory: address(identity['securityPoolFactory'], `${label}.securityPoolFactory`),
		securityPoolForker: address(identity['securityPoolForker'], `${label}.securityPoolForker`),
		tradingFactory: address(identity['tradingFactory'], `${label}.tradingFactory`),
		tradingRouter: address(identity['tradingRouter'], `${label}.tradingRouter`),
		weth: address(identity['weth'], `${label}.weth`),
		zoltar: address(identity['zoltar'], `${label}.zoltar`),
	}
}

function parseQuestion(value: unknown, index: number): QuestionSnapshot {
	const label = `immutable topology question ${index.toString()}`
	const question = requiredRecord(value, label)
	assertExactKeys(question, ['createdAt', 'endTime', 'id', 'kind', 'numTicks', 'outcomeLabels', 'startTime'], label)
	if (question['kind'] !== 'binary' && question['kind'] !== 'categorical' && question['kind'] !== 'scalar') throw new Error(`${label}.kind is unsupported`)
	if (!Array.isArray(question['outcomeLabels']) || question['outcomeLabels'].length > 256) throw new Error(`${label}.outcomeLabels must contain at most 256 labels`)
	return {
		createdAt: unsignedIntegerString(question['createdAt'], `${label}.createdAt`),
		endTime: unsignedIntegerString(question['endTime'], `${label}.endTime`),
		id: unsignedIntegerString(question['id'], `${label}.id`),
		kind: question['kind'],
		numTicks: unsignedIntegerString(question['numTicks'], `${label}.numTicks`),
		outcomeLabels: question['outcomeLabels'].map((outcome, outcomeIndex) => boundedString(outcome, `${label}.outcomeLabels[${outcomeIndex.toString()}]`, 16_384)),
		startTime: unsignedIntegerString(question['startTime'], `${label}.startTime`),
	}
}

function parsePoolDeployment(value: unknown, index: number): CachedPoolDeployment {
	const label = `immutable topology pool deployment ${index.toString()}`
	const deployment = requiredRecord(value, label)
	assertExactKeys(deployment, ['coordinator', 'parent', 'questionId', 'securityPool', 'shareToken', 'truthAuction', 'universeId'], label)
	return {
		coordinator: address(deployment['coordinator'], `${label}.coordinator`),
		parent: address(deployment['parent'], `${label}.parent`),
		questionId: unsignedIntegerString(deployment['questionId'], `${label}.questionId`),
		securityPool: address(deployment['securityPool'], `${label}.securityPool`),
		shareToken: address(deployment['shareToken'], `${label}.shareToken`),
		truthAuction: address(deployment['truthAuction'], `${label}.truthAuction`),
		universeId: unsignedIntegerString(deployment['universeId'], `${label}.universeId`),
	}
}

function compareUnsignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

function parseTopologyCache(value: unknown): CanonicalImmutableTopologyCache {
	const cache = requiredRecord(value, 'immutable topology cache')
	assertExactKeys(cache, ['anchor', 'pairsByPool', 'poolDeployments', 'questions', 'schemaVersion', 'universeChildren', 'vaultsByPool'], 'immutable topology cache')
	if (cache['schemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION) throw new Error('Immutable topology cache schema is unsupported')
	const anchor = requiredRecord(cache['anchor'], 'immutable topology cache.anchor')
	assertExactKeys(anchor, ['blockHash', 'blockNumber'], 'immutable topology cache.anchor')
	if (!Array.isArray(cache['questions'])) throw new Error('immutable topology cache.questions must be an array')
	const questions = cache['questions'].map((question, index) => parseQuestion(question, index))
	if (new Set(questions.map(question => question.id)).size !== questions.length) throw new Error('Immutable topology cache contains duplicate question IDs')
	if (!Array.isArray(cache['poolDeployments'])) throw new Error('immutable topology cache.poolDeployments must be an array')
	const poolDeployments = cache['poolDeployments'].map((deployment, index) => parsePoolDeployment(deployment, index))
	if (new Set(poolDeployments.map(deployment => deployment.securityPool.toLowerCase())).size !== poolDeployments.length) throw new Error('Immutable topology cache contains duplicate security pools')
	const rawChildren = requiredRecord(cache['universeChildren'], 'immutable topology cache.universeChildren')
	const universeChildren: Record<string, CachedUniverseChildren> = {}
	for (const universeId of Object.keys(rawChildren).sort(compareUnsignedStrings)) {
		unsignedIntegerString(universeId, `immutable topology cache.universeChildren key ${universeId}`)
		const children = requiredRecord(rawChildren[universeId], `immutable topology cache.universeChildren.${universeId}`)
		assertExactKeys(children, ['childUniverseIds', 'outcomeIndexes'], `immutable topology cache.universeChildren.${universeId}`)
		if (!Array.isArray(children['childUniverseIds']) || !Array.isArray(children['outcomeIndexes'])) throw new Error(`immutable topology cache.universeChildren.${universeId} routes must be arrays`)
		const childUniverseIds = children['childUniverseIds'].map((child, index) => unsignedIntegerString(child, `immutable topology cache.universeChildren.${universeId}.childUniverseIds[${index.toString()}]`))
		const outcomeIndexes = children['outcomeIndexes'].map((outcome, index) => unsignedIntegerString(outcome, `immutable topology cache.universeChildren.${universeId}.outcomeIndexes[${index.toString()}]`))
		if (childUniverseIds.length !== outcomeIndexes.length) throw new Error(`immutable topology cache.universeChildren.${universeId} route arrays have different lengths`)
		if (new Set(childUniverseIds).size !== childUniverseIds.length || new Set(outcomeIndexes).size !== outcomeIndexes.length) throw new Error(`immutable topology cache.universeChildren.${universeId} contains duplicate routes`)
		universeChildren[universeId] = { childUniverseIds, outcomeIndexes }
	}
	const rawVaults = requiredRecord(cache['vaultsByPool'], 'immutable topology cache.vaultsByPool')
	const vaultsByPool: Record<string, Address[]> = {}
	for (const rawPool of Object.keys(rawVaults).sort((left, right) => left.localeCompare(right))) {
		const pool = address(rawPool, `immutable topology cache.vaultsByPool key ${rawPool}`).toLowerCase()
		if (pool !== rawPool) throw new Error(`immutable topology cache.vaultsByPool key ${rawPool} must be lowercase`)
		const rawPoolVaults = rawVaults[rawPool]
		if (!Array.isArray(rawPoolVaults)) throw new Error(`immutable topology cache.vaultsByPool.${rawPool} must be an array`)
		const vaults = rawPoolVaults.map((vault, index) => address(vault, `immutable topology cache.vaultsByPool.${rawPool}[${index.toString()}]`))
		if (new Set(vaults.map(vault => vault.toLowerCase())).size !== vaults.length) throw new Error(`immutable topology cache.vaultsByPool.${rawPool} contains duplicate vaults`)
		vaultsByPool[pool] = vaults
	}
	const rawPairs = requiredRecord(cache['pairsByPool'], 'immutable topology cache.pairsByPool')
	const pairsByPool: Record<string, Address> = {}
	const pairIdentities = new Set<string>()
	for (const rawPool of Object.keys(rawPairs).sort((left, right) => left.localeCompare(right))) {
		const pool = address(rawPool, `immutable topology cache.pairsByPool key ${rawPool}`).toLowerCase()
		if (pool !== rawPool) throw new Error(`immutable topology cache.pairsByPool key ${rawPool} must be lowercase`)
		const pair = address(rawPairs[rawPool], `immutable topology cache.pairsByPool.${rawPool}`)
		if (pair === zeroAddress) throw new Error(`immutable topology cache.pairsByPool.${rawPool} cannot cache the zero address`)
		if (pairIdentities.has(pair.toLowerCase())) throw new Error(`immutable topology cache pair ${pair} is assigned to multiple pools`)
		pairIdentities.add(pair.toLowerCase())
		pairsByPool[pool] = pair
	}
	return {
		anchor: {
			blockHash: hash(anchor['blockHash'], 'immutable topology cache.anchor.blockHash'),
			blockNumber: unsignedIntegerString(anchor['blockNumber'], 'immutable topology cache.anchor.blockNumber'),
		},
		pairsByPool,
		poolDeployments,
		questions,
		schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		universeChildren,
		vaultsByPool,
	}
}

function sameIdentity(left: ImmutableTopologyIdentity, right: ImmutableTopologyIdentity) {
	return (
		left.chainId === right.chainId &&
		left.openOracle.toLowerCase() === right.openOracle.toLowerCase() &&
		left.questionData.toLowerCase() === right.questionData.toLowerCase() &&
		left.securityPoolFactory.toLowerCase() === right.securityPoolFactory.toLowerCase() &&
		left.securityPoolForker.toLowerCase() === right.securityPoolForker.toLowerCase() &&
		left.tradingFactory.toLowerCase() === right.tradingFactory.toLowerCase() &&
		left.tradingRouter.toLowerCase() === right.tradingRouter.toLowerCase() &&
		left.weth.toLowerCase() === right.weth.toLowerCase() &&
		left.zoltar.toLowerCase() === right.zoltar.toLowerCase()
	)
}

function sha256(value: string | Uint8Array) {
	return `0x${createHash('sha256').update(value).digest('hex')}` as Hex
}

function segmentsDigest(digests: readonly Hex[]) {
	const hasher = createHash('sha256')
	for (let ordinal = 0; ordinal < digests.length; ordinal += 1) hasher.update(`${ordinal.toString()}:${digests[ordinal] ?? ''}\n`, 'utf8')
	return `0x${hasher.digest('hex')}` as Hex
}

function manifestPayload(parameters: Omit<TopologyManifestPayload, 'manifestSchemaVersion' | 'payloadSchemaVersion' | 'storeSchemaVersion'>): TopologyManifestPayload {
	return {
		...parameters,
		manifestSchemaVersion: TOPOLOGY_MANIFEST_SCHEMA_VERSION,
		payloadSchemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		storeSchemaVersion: TOPOLOGY_STORE_SCHEMA_VERSION,
	}
}

function manifestWithDigest(payload: TopologyManifestPayload): TopologyManifest {
	return { ...payload, manifestDigest: sha256(JSON.stringify(payload)) }
}

function errorCode(error: unknown) {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

async function ownerDirectory(path: string, label: string) {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
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

async function readOwnerFile(path: string, maximumBytes: number, label: string) {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isFile()) throw new Error(`${label} ${path} must be a regular file`)
		if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${label} ${path} must have owner-only mode 0600`)
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${label} ${path} must be owned by the bot process user`)
		if (metadata.size > maximumBytes) throw new Error(`${label} ${path} exceeds its ${maximumBytes.toString()}-byte safety limit`)
		return await handle.readFile()
	} catch (error) {
		if (errorCode(error) === 'ELOOP') throw new Error(`${label} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

async function writeOwnerFile(path: string, contents: string | Uint8Array) {
	const handle = await open(path, 'wx', 0o600)
	try {
		await handle.writeFile(contents)
		await handle.chmod(0o600)
		await handle.sync()
	} finally {
		await handle.close()
	}
}

async function syncDirectory(path: string) {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

export function immutableTopologySidecarDirectory(statePath: string) {
	return `${resolve(statePath)}.immutable-topology-v1`
}

function generationDirectory(statePath: string, digest: Hex) {
	return `${immutableTopologySidecarDirectory(statePath)}/${digest.slice(2)}`
}

function segmentFilename(ordinal: number, digest: Hex) {
	return `segment-${ordinal.toString()}-${digest.slice(2)}.bin`
}

function parseJson(contents: Uint8Array, label: string) {
	try {
		return JSON.parse(Buffer.from(contents).toString('utf8')) as unknown
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON: ${error.message}`)
		throw error
	}
}

function parsePointer(value: unknown): TopologyPointer {
	const pointer = requiredRecord(value, 'immutable topology pointer')
	assertExactKeys(pointer, ['manifestDigest', 'schemaVersion'], 'immutable topology pointer')
	if (pointer['schemaVersion'] !== TOPOLOGY_POINTER_SCHEMA_VERSION) throw new Error('Immutable topology pointer schema is unsupported')
	return { manifestDigest: hash(pointer['manifestDigest'], 'immutable topology pointer.manifestDigest'), schemaVersion: TOPOLOGY_POINTER_SCHEMA_VERSION }
}

function parseManifest(value: unknown, expectedDigest: Hex): TopologyManifest {
	const manifest = requiredRecord(value, 'immutable topology manifest')
	assertExactKeys(manifest, ['anchor', 'identity', 'manifestDigest', 'manifestSchemaVersion', 'payloadBytes', 'payloadDigest', 'payloadSchemaVersion', 'segmentCount', 'segmentsDigest', 'storeSchemaVersion'], 'immutable topology manifest')
	if (manifest['manifestSchemaVersion'] !== TOPOLOGY_MANIFEST_SCHEMA_VERSION || manifest['payloadSchemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION || manifest['storeSchemaVersion'] !== TOPOLOGY_STORE_SCHEMA_VERSION) {
		throw new Error('Immutable topology manifest schema is unsupported')
	}
	const anchor = requiredRecord(manifest['anchor'], 'immutable topology manifest.anchor')
	assertExactKeys(anchor, ['blockHash', 'blockNumber'], 'immutable topology manifest.anchor')
	const payload = manifestPayload({
		anchor: {
			blockHash: hash(anchor['blockHash'], 'immutable topology manifest.anchor.blockHash'),
			blockNumber: unsignedIntegerString(anchor['blockNumber'], 'immutable topology manifest.anchor.blockNumber'),
		},
		identity: parseIdentity(manifest['identity'], 'immutable topology manifest.identity'),
		payloadBytes: unsignedIntegerString(manifest['payloadBytes'], 'immutable topology manifest.payloadBytes'),
		payloadDigest: hash(manifest['payloadDigest'], 'immutable topology manifest.payloadDigest'),
		segmentCount: unsignedIntegerString(manifest['segmentCount'], 'immutable topology manifest.segmentCount'),
		segmentsDigest: hash(manifest['segmentsDigest'], 'immutable topology manifest.segmentsDigest'),
	})
	const parsed = manifestWithDigest(payload)
	const recordedDigest = hash(manifest['manifestDigest'], 'immutable topology manifest.manifestDigest')
	if (recordedDigest !== expectedDigest.toLowerCase() || recordedDigest !== parsed.manifestDigest) throw new Error('Immutable topology manifest digest does not match its committed payload')
	return parsed
}

function safeCount(value: string, label: string) {
	const count = BigInt(value)
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the runtime safe iterable range`)
	return Number(count)
}

async function loadGeneration(statePath: string, digest: Hex, expectedIdentity: ImmutableTopologyIdentity) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	const generationPath = generationDirectory(statePath, digest)
	await ownerDirectory(storePath, 'Immutable topology store')
	await ownerDirectory(generationPath, 'Immutable topology generation')
	const manifest = parseManifest(parseJson(await readOwnerFile(`${generationPath}/manifest.json`, IMMUTABLE_TOPOLOGY_MANIFEST_BYTES, 'Immutable topology manifest'), 'Immutable topology manifest'), digest)
	if (!sameIdentity(manifest.identity, expectedIdentity)) return undefined
	const expectedSegments = safeCount(manifest.segmentCount, 'Immutable topology segment count')
	const expectedPayloadBytes = BigInt(manifest.payloadBytes)
	if (expectedPayloadBytes > BigInt(bufferConstants.MAX_LENGTH)) throw new Error('Immutable topology payload exceeds the runtime buffer limit')
	const entries = await readdir(generationPath, { withFileTypes: true })
	const segments = new Map<number, { digest: Hex; name: string }>()
	let foundManifest = false
	for (const entry of entries) {
		if (entry.name === 'manifest.json') {
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Immutable topology manifest must be a regular non-symbolic-link file')
			foundManifest = true
			continue
		}
		const match = SEGMENT_FILE.exec(entry.name)
		if (match === null || !entry.isFile() || entry.isSymbolicLink()) throw new Error(`Immutable topology generation contains unsupported entry ${entry.name}`)
		const ordinalText = match[1]
		const digestText = match[2]
		if (ordinalText === undefined || digestText === undefined) throw new Error(`Immutable topology segment ${entry.name} has an invalid identity`)
		const ordinal = safeCount(ordinalText, `Immutable topology segment ${entry.name} ordinal`)
		if (segments.has(ordinal)) throw new Error(`Immutable topology generation contains duplicate segment ordinal ${ordinal.toString()}`)
		segments.set(ordinal, { digest: `0x${digestText}` as Hex, name: entry.name })
	}
	if (!foundManifest || segments.size !== expectedSegments) throw new Error('Immutable topology generation is missing or has extra committed files')
	const payloadSegments: Buffer[] = []
	const digests: Hex[] = []
	for (let ordinal = 0; ordinal < expectedSegments; ordinal += 1) {
		const segment = segments.get(ordinal)
		if (segment === undefined) throw new Error(`Immutable topology generation is missing segment ${ordinal.toString()}`)
		const contents = Buffer.from(await readOwnerFile(`${generationPath}/${segment.name}`, IMMUTABLE_TOPOLOGY_SEGMENT_BYTES, 'Immutable topology segment'))
		if (ordinal + 1 < expectedSegments && contents.byteLength !== IMMUTABLE_TOPOLOGY_SEGMENT_BYTES) throw new Error(`Immutable topology segment ${ordinal.toString()} is not a complete canonical segment`)
		const actualDigest = sha256(contents)
		if (actualDigest !== segment.digest) throw new Error(`Immutable topology segment ${ordinal.toString()} digest does not match its immutable filename`)
		digests.push(actualDigest)
		payloadSegments.push(contents)
	}
	if (segmentsDigest(digests) !== manifest.segmentsDigest) throw new Error('Immutable topology segment-root digest does not match its manifest')
	const payload = Buffer.concat(payloadSegments)
	if (BigInt(payload.byteLength) !== expectedPayloadBytes || sha256(payload) !== manifest.payloadDigest) throw new Error('Immutable topology payload does not match its manifest commitment')
	const cache = parseTopologyCache(parseJson(payload, 'Immutable topology payload'))
	if (cache.anchor.blockNumber !== manifest.anchor.blockNumber || cache.anchor.blockHash.toLowerCase() !== manifest.anchor.blockHash.toLowerCase()) throw new Error('Immutable topology payload anchor does not match its manifest')
	return cache
}

export async function loadImmutableTopologyCache(statePath: string, expectedIdentity: ImmutableTopologyIdentity) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	try {
		await ownerDirectory(storePath, 'Immutable topology store')
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined
		throw error
	}
	let pointerContents: Uint8Array
	try {
		pointerContents = await readOwnerFile(`${storePath}/current.json`, IMMUTABLE_TOPOLOGY_MANIFEST_BYTES, 'Immutable topology pointer')
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined
		throw error
	}
	const pointer = parsePointer(parseJson(pointerContents, 'Immutable topology pointer'))
	return await loadGeneration(statePath, pointer.manifestDigest, parseIdentity(expectedIdentity, 'expected immutable topology identity'))
}

function isExistingTargetError(error: unknown) {
	const code = errorCode(error)
	return code === 'EEXIST' || code === 'ENOTEMPTY'
}

async function pruneGenerations(storePath: string, retainedGeneration: string) {
	for (const entry of await readdir(storePath, { withFileTypes: true })) {
		if (entry.name === 'current.json' || entry.name === retainedGeneration) continue
		if (!GENERATION_NAME.test(entry.name) && !TEMPORARY_GENERATION_NAME.test(entry.name) && !TEMPORARY_POINTER_NAME.test(entry.name)) continue
		await rm(`${storePath}/${entry.name}`, { force: true, recursive: true })
	}
	await syncDirectory(storePath)
}

export async function saveImmutableTopologyCache(statePath: string, identity: ImmutableTopologyIdentity, value: CanonicalImmutableTopologyCache) {
	const parsedIdentity = parseIdentity(identity, 'immutable topology identity')
	const cache = parseTopologyCache(value)
	const payload = Buffer.from(`${JSON.stringify(cache)}\n`, 'utf8')
	const storePath = immutableTopologySidecarDirectory(statePath)
	await mkdir(storePath, { mode: 0o700, recursive: true })
	await ownerDirectory(storePath, 'Immutable topology store')
	const temporaryPath = `${storePath}/.tmp-${process.pid.toString()}-${randomUUID()}`
	await mkdir(temporaryPath, { mode: 0o700 })
	await ownerDirectory(temporaryPath, 'Temporary immutable topology generation')
	let renamedGeneration = false
	try {
		const digests: Hex[] = []
		for (let offset = 0, ordinal = 0; offset < payload.byteLength; offset += IMMUTABLE_TOPOLOGY_SEGMENT_BYTES, ordinal += 1) {
			const segment = payload.subarray(offset, Math.min(offset + IMMUTABLE_TOPOLOGY_SEGMENT_BYTES, payload.byteLength))
			const digest = sha256(segment)
			await writeOwnerFile(`${temporaryPath}/${segmentFilename(ordinal, digest)}`, segment)
			digests.push(digest)
		}
		const manifest = manifestWithDigest(
			manifestPayload({
				anchor: { ...cache.anchor },
				identity: parsedIdentity,
				payloadBytes: payload.byteLength.toString(),
				payloadDigest: sha256(payload),
				segmentCount: digests.length.toString(),
				segmentsDigest: segmentsDigest(digests),
			}),
		)
		const manifestContents = `${JSON.stringify(manifest)}\n`
		if (Buffer.byteLength(manifestContents, 'utf8') > IMMUTABLE_TOPOLOGY_MANIFEST_BYTES) throw new Error('Immutable topology manifest exceeds its fixed safety envelope')
		await writeOwnerFile(`${temporaryPath}/manifest.json`, manifestContents)
		await syncDirectory(temporaryPath)
		const generationName = manifest.manifestDigest.slice(2)
		const targetPath = `${storePath}/${generationName}`
		try {
			await rename(temporaryPath, targetPath)
			renamedGeneration = true
			await syncDirectory(storePath)
		} catch (error) {
			if (!isExistingTargetError(error)) throw error
			await rm(temporaryPath, { force: true, recursive: true })
		}
		await loadGeneration(statePath, manifest.manifestDigest, parsedIdentity)
		const pointerPath = `${storePath}/current.json`
		const temporaryPointerPath = `${storePath}/.current-${process.pid.toString()}-${randomUUID()}.json`
		await writeOwnerFile(temporaryPointerPath, `${JSON.stringify({ manifestDigest: manifest.manifestDigest, schemaVersion: TOPOLOGY_POINTER_SCHEMA_VERSION } satisfies TopologyPointer)}\n`)
		try {
			await rename(temporaryPointerPath, pointerPath)
		} catch (error) {
			await rm(temporaryPointerPath, { force: true })
			throw error
		}
		await syncDirectory(storePath)
		await pruneGenerations(storePath, generationName)
	} catch (error) {
		if (!renamedGeneration) await rm(temporaryPath, { force: true, recursive: true })
		throw error
	}
}
