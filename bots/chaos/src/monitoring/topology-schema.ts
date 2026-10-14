import { getAddress, zeroAddress, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { compareUnsignedStrings } from '../core/units.ts'
import type { QuestionSnapshot } from '../operations/types.ts'

import { assertExactKeys, normalizedHash32 as hash, requiredRecord, uint256String as unsignedIntegerString } from '../state/validators.ts'

export const IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION = 3
export const IMMUTABLE_TOPOLOGY_SEGMENT_BYTES = 32 * 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MANIFEST_BYTES = 64 * 1024
export const IMMUTABLE_TOPOLOGY_MAXIMUM_COMMITTED_BYTES = 64 * 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MAXIMUM_RESIDENT_ITEMS = 100_000
export const IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES = 4 * 1024 * 1024
export const IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES = IMMUTABLE_TOPOLOGY_SEGMENT_BYTES - 1024
const configuredResidentLimitErrors = new WeakSet<Error>()

export function isConfiguredResidentLimitError(error: unknown) {
	return error instanceof Error && configuredResidentLimitErrors.has(error)
}

export function configuredResidentLimitError(message: string) {
	const error = new Error(message)
	configuredResidentLimitErrors.add(error)
	return error
}

export interface ImmutableTopologyIdentity {
	chainId: number
	openOracle: Address
	questionData: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	tradingFactory: Address
	tradingRouter: Address
	uniswapV3Factory?: Address | undefined
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

interface CachedUniverseChildren {
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

export function boundedString(value: unknown, label: string, maximumLength: number) {
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

export function parseCountedRegistryCursor(value: unknown, label: string): CountedRegistryCursor {
	const cursor = requiredRecord(value, label)
	assertExactKeys(cursor, ['canonicalCount', 'commitment', 'nextIndex', 'residentLimit', 'retentionMode'], [], label)
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
	assertExactKeys(cursors, ['poolDeployments', 'questions', 'vaultsByPool'], [], label)
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

export function parseIdentity(value: unknown, label: string): ImmutableTopologyIdentity {
	const identity = requiredRecord(value, label)
	const addressFields = ['openOracle', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'tradingFactory', 'tradingRouter', 'weth', 'zoltar'] as const
	assertExactKeys(identity, ['chainId', ...addressFields, ...('uniswapV3Factory' in identity ? ['uniswapV3Factory'] : [])], [], label)
	if (typeof identity['chainId'] !== 'number' || !Number.isSafeInteger(identity['chainId']) || identity['chainId'] <= 0) throw new Error(`${label}.chainId must be a positive safe integer`)
	return {
		chainId: identity['chainId'],
		openOracle: address(identity['openOracle'], `${label}.openOracle`),
		questionData: address(identity['questionData'], `${label}.questionData`),
		securityPoolFactory: address(identity['securityPoolFactory'], `${label}.securityPoolFactory`),
		securityPoolForker: address(identity['securityPoolForker'], `${label}.securityPoolForker`),
		tradingFactory: address(identity['tradingFactory'], `${label}.tradingFactory`),
		tradingRouter: address(identity['tradingRouter'], `${label}.tradingRouter`),
		...('uniswapV3Factory' in identity ? { uniswapV3Factory: address(identity['uniswapV3Factory'], `${label}.uniswapV3Factory`) } : {}),
		weth: address(identity['weth'], `${label}.weth`),
		zoltar: address(identity['zoltar'], `${label}.zoltar`),
	}
}

function parseQuestion(value: unknown, index: number): QuestionSnapshot {
	const label = `immutable topology question ${index.toString()}`
	const question = requiredRecord(value, label)
	assertExactKeys(question, ['createdAt', 'endTime', 'id', 'kind', 'numTicks', 'outcomeLabels', 'startTime'], [], label)
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
	assertExactKeys(deployment, ['coordinator', 'parent', 'questionId', 'securityPool', 'shareToken', 'truthAuction', 'universeId'], [], label)
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

export function parseTopologyCache(value: unknown): CanonicalImmutableTopologyCache {
	const cache = requiredRecord(value, 'immutable topology cache')
	assertExactKeys(cache, ['anchor', 'discoveryCursors', 'pairsByPool', 'poolDeployments', 'questions', 'schemaVersion', 'universeChildren', 'vaultsByPool'], [], 'immutable topology cache')
	if (cache['schemaVersion'] !== IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION) throw new Error('Immutable topology cache schema is unsupported')
	const discoveryCursors = parseDiscoveryCursors(cache['discoveryCursors'], 'immutable topology cache.discoveryCursors')
	const anchor = requiredRecord(cache['anchor'], 'immutable topology cache.anchor')
	assertExactKeys(anchor, ['blockHash', 'blockNumber'], [], 'immutable topology cache.anchor')
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
		assertExactKeys(children, ['childUniverseIds', 'outcomeIndexes'], [], `immutable topology cache.universeChildren.${universeId}`)
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

export function requireResidentLimit(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
}

export function assertTopologyResidentBounds(cache: CanonicalImmutableTopologyCache, limits?: ImmutableTopologyResidentLimits) {
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
