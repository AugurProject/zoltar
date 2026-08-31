import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, opendir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getAddress, zeroAddress, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import type { QuestionSnapshot } from '../operations/types.ts'

export const IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION = 3
export const IMMUTABLE_TOPOLOGY_SEGMENT_BYTES = 32 * 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MANIFEST_BYTES = 64 * 1024
export const IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES = 64 * 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MAXIMUM_RESIDENT_ITEMS = 100_000
export const IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES = 4 * 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES = IMMUTABLE_TOPOLOGY_SEGMENT_BYTES - 1024

const TOPOLOGY_STORE_SCHEMA_VERSION = 2
const TOPOLOGY_MANIFEST_SCHEMA_VERSION = 2
const TOPOLOGY_POINTER_SCHEMA_VERSION = 1
const TOPOLOGY_CHUNK_SCHEMA_VERSION = 1
const TOPOLOGY_CHUNK_RECORDS = 256
const TOPOLOGY_STORE_MAXIMUM_ENTRIES = 256
const COLLECTION_KINDS = ['pairs', 'pool-deployments', 'questions', 'universe-children', 'vault-cursors', 'vaults'] as const
type CollectionKind = (typeof COLLECTION_KINDS)[number]
const GENERATION_NAME = /^[0-9a-f]{64}$/
const TEMPORARY_GENERATION_NAME = /^\.tmp-[0-9]+-[0-9a-f-]+$/
const TEMPORARY_POINTER_NAME = /^\.current-[0-9]+-[0-9a-f-]+\.json$/
const CHUNK_FILE = /^(pairs|pool-deployments|questions|universe-children|vault-cursors|vaults)-(0|[1-9]\d*)-([0-9a-f]{64})\.json$/
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/
const configuredResidentLimitErrors = new WeakSet<Error>()

function configuredResidentLimitError(message: string) {
	const error = new Error(message)
	configuredResidentLimitErrors.add(error)
	return error
}

export function immutableTopologyCacheExceedsConfiguredResidentLimits(error: unknown) {
	return error instanceof Error && configuredResidentLimitErrors.has(error)
}

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

export interface CountedRegistryCursor {
	canonicalCount: string
	commitment: Hash
	nextIndex: string
	residentLimit: string
	retentionMode: 'overflow' | 'resident'
}

export interface ImmutableTopologyDiscoveryCursors {
	poolDeployments: CountedRegistryCursor
	questions: CountedRegistryCursor
	vaultsByPool: Record<string, CountedRegistryCursor>
}

export interface ImmutableTopologyData {
	discoveryCursors: ImmutableTopologyDiscoveryCursors
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

export interface ImmutableTopologyResidentLimits {
	maxPools: number
	maxQuestions: number
	maxUniverses: number
	maxVaultsPerPool: number
}

export function emptyCountedRegistryCursor(): CountedRegistryCursor {
	return { canonicalCount: '0', commitment: `0x${'0'.repeat(64)}`, nextIndex: '0', residentLimit: '0', retentionMode: 'resident' }
}

export function emptyImmutableTopologyData(): ImmutableTopologyData {
	return {
		discoveryCursors: {
			poolDeployments: emptyCountedRegistryCursor(),
			questions: emptyCountedRegistryCursor(),
			vaultsByPool: {},
		},
		pairsByPool: {},
		poolDeployments: [],
		questions: [],
		universeChildren: {},
		vaultsByPool: {},
	}
}

export function cloneImmutableTopologyData(cache: ImmutableTopologyData): ImmutableTopologyData {
	return {
		discoveryCursors: {
			poolDeployments: { ...cache.discoveryCursors.poolDeployments },
			questions: { ...cache.discoveryCursors.questions },
			vaultsByPool: Object.fromEntries(Object.entries(cache.discoveryCursors.vaultsByPool).map(([pool, cursor]) => [pool, { ...cursor }])),
		},
		pairsByPool: { ...cache.pairsByPool },
		poolDeployments: cache.poolDeployments.map(deployment => ({ ...deployment })),
		questions: cache.questions.map(question => ({ ...question, outcomeLabels: [...question.outcomeLabels] })),
		universeChildren: Object.fromEntries(Object.entries(cache.universeChildren).map(([universeId, children]) => [universeId, { childUniverseIds: [...children.childUniverseIds], outcomeIndexes: [...children.outcomeIndexes] }])),
		vaultsByPool: Object.fromEntries(Object.entries(cache.vaultsByPool).map(([pool, vaults]) => [pool, [...vaults]])),
	}
}

type CollectionCommitment = {
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

function boundedUtf8String(value: unknown, label: string, maximumBytes: number) {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes) throw new Error(`${label} must be a UTF-8 string of at most ${maximumBytes.toString()} bytes`)
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

function parseCountedRegistryCursor(value: unknown, label: string): CountedRegistryCursor {
	const cursor = requiredRecord(value, label)
	assertExactKeys(cursor, ['canonicalCount', 'commitment', 'nextIndex', 'residentLimit', 'retentionMode'], label)
	const canonicalCount = unsignedIntegerString(cursor['canonicalCount'], `${label}.canonicalCount`)
	const nextIndex = unsignedIntegerString(cursor['nextIndex'], `${label}.nextIndex`)
	if (BigInt(nextIndex) > BigInt(canonicalCount)) throw new Error(`${label}.nextIndex exceeds its canonical count`)
	if (cursor['retentionMode'] !== 'overflow' && cursor['retentionMode'] !== 'resident') throw new Error(`${label}.retentionMode is unsupported`)
	return {
		canonicalCount,
		commitment: hash(cursor['commitment'], `${label}.commitment`),
		nextIndex,
		residentLimit: unsignedIntegerString(cursor['residentLimit'], `${label}.residentLimit`),
		retentionMode: cursor['retentionMode'],
	}
}

function parseDiscoveryCursors(value: unknown, label: string): ImmutableTopologyDiscoveryCursors {
	const cursors = requiredRecord(value, label)
	assertExactKeys(cursors, ['poolDeployments', 'questions', 'vaultsByPool'], label)
	const rawVaults = requiredRecord(cursors['vaultsByPool'], `${label}.vaultsByPool`)
	const vaultsByPool: Record<string, CountedRegistryCursor> = {}
	for (const rawPool of Object.keys(rawVaults).sort((left, right) => left.localeCompare(right))) {
		const pool = address(rawPool, `${label}.vaultsByPool key ${rawPool}`).toLowerCase()
		if (pool !== rawPool) throw new Error(`${label}.vaultsByPool key ${rawPool} must be lowercase`)
		vaultsByPool[pool] = parseCountedRegistryCursor(rawVaults[rawPool], `${label}.vaultsByPool.${rawPool}`)
	}
	return {
		poolDeployments: parseCountedRegistryCursor(cursors['poolDeployments'], `${label}.poolDeployments`),
		questions: parseCountedRegistryCursor(cursors['questions'], `${label}.questions`),
		vaultsByPool,
	}
}

function parseManifestDiscoveryCursors(value: unknown, label: string): ManifestDiscoveryCursors {
	const cursors = requiredRecord(value, label)
	assertExactKeys(cursors, ['poolDeployments', 'questions'], label)
	return {
		poolDeployments: parseCountedRegistryCursor(cursors['poolDeployments'], `${label}.poolDeployments`),
		questions: parseCountedRegistryCursor(cursors['questions'], `${label}.questions`),
	}
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
	if (!Array.isArray(question['outcomeLabels'])) throw new Error(`${label}.outcomeLabels must be an array`)
	const outcomeLabels = question['outcomeLabels'].map((outcome, outcomeIndex) => boundedUtf8String(outcome, `${label}.outcomeLabels[${outcomeIndex.toString()}]`, IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES))
	const outcomeLabelBytes = outcomeLabels.reduce((total, outcome) => total + Buffer.byteLength(outcome, 'utf8'), 0)
	if (outcomeLabelBytes > IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES) {
		throw new Error(`${label}.outcomeLabels exceed the ${IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES.toString()}-byte immutable-topology safety envelope`)
	}
	const parsed: QuestionSnapshot = {
		createdAt: unsignedIntegerString(question['createdAt'], `${label}.createdAt`),
		endTime: unsignedIntegerString(question['endTime'], `${label}.endTime`),
		id: unsignedIntegerString(question['id'], `${label}.id`),
		kind: question['kind'],
		numTicks: unsignedIntegerString(question['numTicks'], `${label}.numTicks`),
		outcomeLabels,
		startTime: unsignedIntegerString(question['startTime'], `${label}.startTime`),
	}
	if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES) throw new Error(`${label} exceeds the immutable-topology record byte envelope`)
	return parsed
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
	assertExactKeys(cache, ['anchor', 'discoveryCursors', 'pairsByPool', 'poolDeployments', 'questions', 'schemaVersion', 'universeChildren', 'vaultsByPool'], 'immutable topology cache')
	if (cache['schemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION) throw new Error('Immutable topology cache schema is unsupported')
	const discoveryCursors = parseDiscoveryCursors(cache['discoveryCursors'], 'immutable topology cache.discoveryCursors')
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
		discoveryCursors,
		pairsByPool,
		poolDeployments,
		questions,
		schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		universeChildren,
		vaultsByPool,
	}
}

function topologyResidentItemCount(cache: ImmutableTopologyData) {
	let count = 2 + cache.poolDeployments.length + Object.keys(cache.pairsByPool).length + Object.keys(cache.discoveryCursors.vaultsByPool).length
	for (const question of cache.questions) count += 1 + question.outcomeLabels.length
	for (const children of Object.values(cache.universeChildren)) count += 1 + children.childUniverseIds.length + children.outcomeIndexes.length
	for (const vaults of Object.values(cache.vaultsByPool)) count += 1 + vaults.length
	return count
}

function requireResidentLimit(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
}

function assertTopologyResidentBounds(cache: CanonicalImmutableTopologyCache, limits?: ImmutableTopologyResidentLimits) {
	if (topologyResidentItemCount(cache) > IMMUTABLE_TOPOLOGY_MAXIMUM_RESIDENT_ITEMS) {
		throw new Error(`Immutable topology cache exceeds its ${IMMUTABLE_TOPOLOGY_MAXIMUM_RESIDENT_ITEMS.toString()}-item resident safety limit`)
	}
	if (limits !== undefined) {
		requireResidentLimit(limits.maxPools, 'Immutable topology maxPools')
		requireResidentLimit(limits.maxQuestions, 'Immutable topology maxQuestions')
		requireResidentLimit(limits.maxUniverses, 'Immutable topology maxUniverses')
		requireResidentLimit(limits.maxVaultsPerPool, 'Immutable topology maxVaultsPerPool')
		if (cache.poolDeployments.length > limits.maxPools) throw configuredResidentLimitError('Immutable topology cache exceeds the configured pool resident limit')
		if (cache.questions.length > limits.maxQuestions) throw configuredResidentLimitError('Immutable topology cache exceeds the configured question resident limit')
		if (Object.keys(cache.pairsByPool).length > limits.maxPools) throw configuredResidentLimitError('Immutable topology cache contains more pairs than the configured pool limit')
		if (Object.keys(cache.discoveryCursors.vaultsByPool).length > limits.maxPools) throw configuredResidentLimitError('Immutable topology cache contains more vault cursors than the configured pool limit')
		if (Object.keys(cache.vaultsByPool).length > limits.maxPools) throw configuredResidentLimitError('Immutable topology cache contains more vault registries than the configured pool limit')
		const universeIds = new Set(Object.keys(cache.universeChildren))
		for (const children of Object.values(cache.universeChildren)) {
			for (const childId of children.childUniverseIds) universeIds.add(childId)
		}
		if (universeIds.size > limits.maxUniverses) throw configuredResidentLimitError('Immutable topology cache exceeds the configured universe resident limit')
		for (const vaults of Object.values(cache.vaultsByPool)) {
			if (vaults.length > limits.maxVaultsPerPool) throw configuredResidentLimitError('Immutable topology cache exceeds the configured per-pool vault resident limit')
		}
	}
	const { poolDeployments, questions, vaultsByPool } = cache.discoveryCursors
	if (poolDeployments.retentionMode === 'resident' ? BigInt(cache.poolDeployments.length) !== BigInt(poolDeployments.nextIndex) : cache.poolDeployments.length !== 0) {
		throw new Error('Immutable topology pool cursor does not match its resident records')
	}
	if (questions.retentionMode === 'resident' ? BigInt(cache.questions.length) !== BigInt(questions.nextIndex) : cache.questions.length !== 0) {
		throw new Error('Immutable topology question cursor does not match its resident records')
	}
	for (const [pool, cursor] of Object.entries(vaultsByPool)) {
		const resident = cache.vaultsByPool[pool] ?? []
		if (cursor.retentionMode === 'resident' ? BigInt(resident.length) !== BigInt(cursor.nextIndex) : resident.length !== 0) {
			throw new Error(`Immutable topology vault cursor for ${pool} does not match its resident records`)
		}
	}
}

export function validateImmutableTopologyCache(value: CanonicalImmutableTopologyCache, limits?: ImmutableTopologyResidentLimits) {
	const cache = parseTopologyCache(value)
	assertTopologyResidentBounds(cache, limits)
	return cache
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

function collectionDigest(digests: readonly Hex[]) {
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

function chunkFilename(kind: CollectionKind, ordinal: number, digest: Hex) {
	return `${kind}-${ordinal.toString()}-${digest.slice(2)}.json`
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

function parseCollectionCommitment(value: unknown, label: string): CollectionCommitment {
	const commitment = requiredRecord(value, label)
	assertExactKeys(commitment, ['chunkCount', 'chunksDigest', 'committedBytes', 'itemCount', 'recordCount'], label)
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

function parseManifest(value: unknown, expectedDigest: Hex): TopologyManifest {
	const manifest = requiredRecord(value, 'immutable topology manifest')
	assertExactKeys(manifest, ['anchor', 'collections', 'discoveryCursors', 'identity', 'manifestDigest', 'manifestSchemaVersion', 'payloadSchemaVersion', 'storeSchemaVersion'], 'immutable topology manifest')
	if (manifest['manifestSchemaVersion'] !== TOPOLOGY_MANIFEST_SCHEMA_VERSION || manifest['payloadSchemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION || manifest['storeSchemaVersion'] !== TOPOLOGY_STORE_SCHEMA_VERSION) {
		throw new Error('Immutable topology manifest schema is unsupported')
	}
	const anchor = requiredRecord(manifest['anchor'], 'immutable topology manifest.anchor')
	assertExactKeys(anchor, ['blockHash', 'blockNumber'], 'immutable topology manifest.anchor')
	const rawCollections = requiredRecord(manifest['collections'], 'immutable topology manifest.collections')
	assertExactKeys(rawCollections, COLLECTION_KINDS, 'immutable topology manifest.collections')
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

function safeCount(value: string, label: string) {
	const count = BigInt(value)
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the runtime safe iterable range`)
	return Number(count)
}

type TopologyCollectionRecord = {
	items: number
	value: unknown
}

function* topologyCollectionRecords(cache: CanonicalImmutableTopologyCache, kind: CollectionKind): Generator<TopologyCollectionRecord> {
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

function collectionStatistics(cache: CanonicalImmutableTopologyCache, kind: CollectionKind) {
	let itemCount = 0n
	let recordCount = 0n
	for (const record of topologyCollectionRecords(cache, kind)) {
		itemCount += BigInt(record.items)
		recordCount += 1n
	}
	return { itemCount: itemCount.toString(), recordCount: recordCount.toString() }
}

function assertManifestResidentBounds(manifest: TopologyManifest, limits?: ImmutableTopologyResidentLimits) {
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

function collectionKind(value: string | undefined): CollectionKind | undefined {
	return COLLECTION_KINDS.find(candidate => candidate === value)
}

function emptyCollectionFiles(): CollectionFiles {
	return Object.fromEntries(COLLECTION_KINDS.map(kind => [kind, new Map<number, { digest: Hex; name: string }>()])) as CollectionFiles
}

function appendLoadedRecord(
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
		assertExactKeys(record, ['pair', 'pool'], `immutable topology ${kind} record`)
		const pool = boundedString(record['pool'], 'immutable topology pair pool', 42)
		if (pool in loaded.pairsByPool) throw new Error(`Immutable topology pairs contain duplicate pool ${pool}`)
		loaded.pairsByPool[pool] = record['pair']
		return
	}
	if (kind === 'universe-children') {
		assertExactKeys(record, ['childUniverseIds', 'outcomeIndexes', 'universeId'], `immutable topology ${kind} record`)
		const universeId = unsignedIntegerString(record['universeId'], 'immutable topology universe-children universeId')
		if (universeId in loaded.universeChildren) throw new Error(`Immutable topology universe children contain duplicate universe ${universeId}`)
		loaded.universeChildren[universeId] = { childUniverseIds: record['childUniverseIds'], outcomeIndexes: record['outcomeIndexes'] }
		return
	}
	if (kind === 'vault-cursors') {
		assertExactKeys(record, ['cursor', 'pool'], `immutable topology ${kind} record`)
		const pool = boundedString(record['pool'], 'immutable topology vault-cursor pool', 42)
		if (pool in loaded.vaultCursors) throw new Error(`Immutable topology vault cursors contain duplicate pool ${pool}`)
		loaded.vaultCursors[pool] = record['cursor']
		return
	}
	assertExactKeys(record, ['pool', 'vaults'], `immutable topology ${kind} record`)
	const pool = boundedString(record['pool'], 'immutable topology vault-registry pool', 42)
	if (pool in loaded.vaultsByPool) throw new Error(`Immutable topology vault registries contain duplicate pool ${pool}`)
	loaded.vaultsByPool[pool] = record['vaults']
}

function loadedRecordItemCount(kind: CollectionKind, value: unknown) {
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

function parseChunkRecords(contents: Uint8Array, kind: CollectionKind, ordinal: number) {
	const chunk = requiredRecord(parseJson(contents, `Immutable topology ${kind} chunk ${ordinal.toString()}`), `immutable topology ${kind} chunk ${ordinal.toString()}`)
	assertExactKeys(chunk, ['kind', 'ordinal', 'records', 'schemaVersion'], `immutable topology ${kind} chunk ${ordinal.toString()}`)
	if (chunk['schemaVersion'] !== TOPOLOGY_CHUNK_SCHEMA_VERSION || chunk['kind'] !== kind || chunk['ordinal'] !== ordinal.toString()) throw new Error(`Immutable topology ${kind} chunk ${ordinal.toString()} identity is invalid`)
	if (!Array.isArray(chunk['records']) || chunk['records'].length === 0 || chunk['records'].length > TOPOLOGY_CHUNK_RECORDS) {
		throw new Error(`Immutable topology ${kind} chunk ${ordinal.toString()} must contain between 1 and ${TOPOLOGY_CHUNK_RECORDS.toString()} records`)
	}
	return chunk['records']
}

async function loadGeneration(statePath: string, digest: Hex, expectedIdentity: ImmutableTopologyIdentity, limits?: ImmutableTopologyResidentLimits, requireCompatibleIdentity = false) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	const generationPath = generationDirectory(statePath, digest)
	await ownerDirectory(storePath, 'Immutable topology store')
	await ownerDirectory(generationPath, 'Immutable topology generation')
	const rawManifest = parseJson(await readOwnerFile(`${generationPath}/manifest.json`, IMMUTABLE_TOPOLOGY_MANIFEST_BYTES, 'Immutable topology manifest'), 'Immutable topology manifest')
	const manifestRecord = requiredRecord(rawManifest, 'immutable topology manifest')
	// Older payloads retained unbounded registries or possibly truncated labels.
	// Discard them before reading any committed payload into the process.
	if (manifestRecord['payloadSchemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION) {
		if (requireCompatibleIdentity) throw new Error('Immutable topology generation uses an incompatible payload schema')
		return undefined
	}
	const manifest = parseManifest(manifestRecord, digest)
	if (!sameIdentity(manifest.identity, expectedIdentity)) {
		if (requireCompatibleIdentity) throw new Error('Immutable topology generation belongs to a different deployment identity')
		return undefined
	}
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
			const contents = await readOwnerFile(`${generationPath}/${file.name}`, IMMUTABLE_TOPOLOGY_SEGMENT_BYTES, `Immutable topology ${kind} chunk`)
			const actualDigest = sha256(contents)
			if (actualDigest !== file.digest) throw new Error(`Immutable topology ${kind} chunk ${ordinal.toString()} digest does not match its immutable filename`)
			const nextCommittedBytes = committedBytes + BigInt(contents.byteLength)
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

export async function loadImmutableTopologyCache(statePath: string, expectedIdentity: ImmutableTopologyIdentity, limits?: ImmutableTopologyResidentLimits) {
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
	return await loadGeneration(statePath, pointer.manifestDigest, parseIdentity(expectedIdentity, 'expected immutable topology identity'), limits)
}

/** Fully authenticates an existing topology pointer and generation without creating or pruning any state. */
export async function validateImmutableTopologySidecarIfPresent(statePath: string, expectedIdentity: ImmutableTopologyIdentity, limits?: ImmutableTopologyResidentLimits) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	try {
		await ownerDirectory(storePath, 'Immutable topology store')
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return 'absent' as const
		throw error
	}
	let pointerContents: Uint8Array
	try {
		pointerContents = await readOwnerFile(`${storePath}/current.json`, IMMUTABLE_TOPOLOGY_MANIFEST_BYTES, 'Immutable topology pointer')
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return 'absent' as const
		throw error
	}
	const pointer = parsePointer(parseJson(pointerContents, 'Immutable topology pointer'))
	const loaded = await loadGeneration(statePath, pointer.manifestDigest, parseIdentity(expectedIdentity, 'expected immutable topology identity'), limits, true)
	if (loaded === undefined) throw new Error('Immutable topology generation is incompatible with the configured deployment')
	return 'valid' as const
}

function isExistingTargetError(error: unknown) {
	const code = errorCode(error)
	return code === 'EEXIST' || code === 'ENOTEMPTY'
}

async function currentGenerationName(storePath: string) {
	try {
		const pointer = parsePointer(parseJson(await readOwnerFile(`${storePath}/current.json`, IMMUTABLE_TOPOLOGY_MANIFEST_BYTES, 'Immutable topology pointer'), 'Immutable topology pointer'))
		return pointer.manifestDigest.slice(2)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined
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
	await syncDirectory(storePath)
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
		await writeOwnerFile(`${path}/${chunkFilename(kind, digests.length, digest)}`, chunk)
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
	await ownerDirectory(storePath, 'Immutable topology store')
	if (!(await pruneGenerations(storePath, await currentGenerationName(storePath)))) {
		throw new Error(`Immutable topology store cleanup reached its ${TOPOLOGY_STORE_MAXIMUM_ENTRIES.toString()}-entry per-cycle safety limit; retry to continue bounded cleanup`)
	}
	const temporaryPath = `${storePath}/.tmp-${process.pid.toString()}-${randomUUID()}`
	await mkdir(temporaryPath, { mode: 0o700 })
	await ownerDirectory(temporaryPath, 'Temporary immutable topology generation')
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
		await loadGeneration(statePath, manifest.manifestDigest, parsedIdentity, limits)
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
		if (!(await pruneGenerations(storePath, generationName))) throw new Error(`Immutable topology store cleanup reached its ${TOPOLOGY_STORE_MAXIMUM_ENTRIES.toString()}-entry per-cycle safety limit`)
	} catch (error) {
		if (!renamedGeneration) await rm(temporaryPath, { force: true, recursive: true })
		throw error
	}
}
