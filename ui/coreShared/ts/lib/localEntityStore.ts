import { getBrowserStorage } from './browserStorage.js'
import { isStoredRecord } from './storedValueReader.js'

/**
 * Browser-local favorites and a cache of entity summaries the user has already downloaded from chain.
 * Everything is scoped by app, network, and entity kind so a pool favorited on one network never
 * appears on another. Values are versioned, size-capped, and bigint-safe.
 */
export type LocalEntityApp = 'zoltar' | 'statoblast' | 'trading'
export type LocalEntityKind = 'pool' | 'question' | 'market' | 'oracleReport'
export type LocalEntityScope = Readonly<{ app: LocalEntityApp; kind: LocalEntityKind; network: string }>
export type FavoriteEntry = Readonly<{ id: string; addedAt: number }>
export type DownloadedEntry<T> = Readonly<{ id: string; fetchedAt: number; data: T }>
export type DownloadedItem<T> = Readonly<{ id: string; data: T }>

const STORAGE_PREFIX = 'zoltar-ui'
const STORE_VERSION = 1
const BIGINT_TAG = '$bigint'
const FAVORITE_LIMIT = 500
const DOWNLOADED_LIMIT = 200

export function getFavoritesStorageKey(scope: LocalEntityScope) {
	return `${STORAGE_PREFIX}:favorites:v${STORE_VERSION}:${scope.app}:${scope.network}:${scope.kind}`
}

export function getDownloadedStorageKey(scope: LocalEntityScope) {
	return `${STORAGE_PREFIX}:downloaded:v${STORE_VERSION}:${scope.app}:${scope.network}:${scope.kind}`
}

export function normalizeEntityId(id: string) {
	return id.trim().toLowerCase()
}

export function serializeStoredValue(value: unknown) {
	return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? { [BIGINT_TAG]: item.toString() } : item))
}

export function parseStoredValue(text: string): unknown {
	return JSON.parse(text, (_key, item: unknown) => {
		if (!isStoredRecord(item)) return item
		const tagged = item[BIGINT_TAG]
		if (typeof tagged !== 'string' || Object.keys(item).length !== 1 || !/^-?\d+$/.test(tagged)) return item
		return BigInt(tagged)
	})
}

function readTimestamp(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readEnvelopeItems(value: unknown) {
	if (!isStoredRecord(value) || value['version'] !== STORE_VERSION) return []
	const items = value['items']
	return Array.isArray(items) ? items : []
}

export function parseFavoriteEntries(value: unknown): FavoriteEntry[] {
	const seen = new Set<string>()
	return readEnvelopeItems(value).flatMap(item => {
		if (!isStoredRecord(item)) return []
		const id = item['id']
		const addedAt = readTimestamp(item['addedAt'])
		if (typeof id !== 'string' || addedAt === undefined) return []
		const normalizedId = normalizeEntityId(id)
		if (normalizedId === '' || seen.has(normalizedId)) return []
		seen.add(normalizedId)
		return [{ id: normalizedId, addedAt }]
	})
}

export function parseDownloadedEntries<T>(value: unknown, decode: (data: unknown) => T | undefined): DownloadedEntry<T>[] {
	const seen = new Set<string>()
	return readEnvelopeItems(value).flatMap(item => {
		if (!isStoredRecord(item)) return []
		const id = item['id']
		const fetchedAt = readTimestamp(item['fetchedAt'])
		if (typeof id !== 'string' || fetchedAt === undefined) return []
		const normalizedId = normalizeEntityId(id)
		if (normalizedId === '' || seen.has(normalizedId)) return []
		const data = decode(item['data'])
		if (data === undefined) return []
		seen.add(normalizedId)
		return [{ id: normalizedId, fetchedAt, data }]
	})
}

export function hasFavoriteEntry(entries: readonly FavoriteEntry[], id: string) {
	const normalizedId = normalizeEntityId(id)
	return entries.some(entry => entry.id === normalizedId)
}

/** Newest favorites first. Re-adding keeps the original position so auto-favoriting on every visit does not reshuffle the list. */
export function addFavoriteEntry(entries: readonly FavoriteEntry[], id: string, addedAt: number, limit = FAVORITE_LIMIT): FavoriteEntry[] {
	const normalizedId = normalizeEntityId(id)
	if (normalizedId === '' || hasFavoriteEntry(entries, normalizedId)) return [...entries]
	return [{ id: normalizedId, addedAt }, ...entries].slice(0, limit)
}

export function removeFavoriteEntry(entries: readonly FavoriteEntry[], id: string): FavoriteEntry[] {
	const normalizedId = normalizeEntityId(id)
	return entries.filter(entry => entry.id !== normalizedId)
}

/** Replaces cached items by id, keeps the newest fetches, and never evicts a protected (favorited) entry before an unprotected one. */
export function upsertDownloadedEntries<T>(entries: readonly DownloadedEntry<T>[], items: readonly DownloadedItem<T>[], fetchedAt: number, protectedIds: ReadonlySet<string>, limit = DOWNLOADED_LIMIT): DownloadedEntry<T>[] {
	const byId = new Map<string, DownloadedEntry<T>>()
	for (const item of items) {
		const id = normalizeEntityId(item.id)
		if (id === '') continue
		byId.set(id, { id, fetchedAt, data: item.data })
	}
	// Fresh items keep their given (chain) order ahead of older entries; the stable sort only moves stale fetches back.
	for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry)
	const newestFirst = [...byId.values()].sort((left, right) => right.fetchedAt - left.fetchedAt)
	const kept = new Set([...newestFirst.filter(entry => protectedIds.has(entry.id)), ...newestFirst.filter(entry => !protectedIds.has(entry.id))].slice(0, limit))
	return newestFirst.filter(entry => kept.has(entry))
}

type Listener = () => void
const listeners = new Set<Listener>()
const cacheResetters = new Set<() => void>()
const favoritesCache = new Map<string, FavoriteEntry[]>()
cacheResetters.add(() => favoritesCache.clear())
let storageListenerInstalled = false
let storeRevision = 0
let cachedStorage: Storage | undefined = undefined

/** Caches belong to one storage object; a replaced storage (a new document in tests, or a storage reset) starts clean. */
function syncCachesWithStorage() {
	const storage = getBrowserStorage('localStorage')
	if (storage === cachedStorage) return
	cachedStorage = storage
	for (const reset of cacheResetters) reset()
}

function notifyListeners() {
	storeRevision += 1
	for (const listener of [...listeners]) listener()
}

/** Increments on every change, so a subscriber can detect a change that happened between its render and its subscription. */
export function getLocalEntityStoreRevision() {
	return storeRevision
}

function installStorageListener() {
	if (storageListenerInstalled || typeof window === 'undefined') return
	storageListenerInstalled = true
	window.addEventListener('storage', event => {
		if (event.key !== null && !event.key.startsWith(`${STORAGE_PREFIX}:`)) return
		for (const reset of cacheResetters) reset()
		notifyListeners()
	})
}

export function subscribeLocalEntityStore(listener: Listener) {
	installStorageListener()
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function readStorageItem(key: string) {
	try {
		const text = getBrowserStorage('localStorage')?.getItem(key) ?? null
		return text === null ? undefined : parseStoredValue(text)
	} catch (error) {
		if (error instanceof DOMException || error instanceof SyntaxError) return undefined
		throw error
	}
}

function writeStorageItem(key: string, items: readonly unknown[]) {
	try {
		getBrowserStorage('localStorage')?.setItem(key, serializeStoredValue({ version: STORE_VERSION, items }))
		return true
	} catch (error) {
		// Quota and privacy-mode failures keep the in-memory state for this session.
		if (error instanceof DOMException) return false
		throw error
	}
}

export function readFavoriteEntries(scope: LocalEntityScope): FavoriteEntry[] {
	syncCachesWithStorage()
	const key = getFavoritesStorageKey(scope)
	const cached = favoritesCache.get(key)
	if (cached !== undefined) return cached
	const entries = parseFavoriteEntries(readStorageItem(key))
	favoritesCache.set(key, entries)
	return entries
}

export function setEntityFavorite(scope: LocalEntityScope, id: string, favorite: boolean, now = Date.now()) {
	const current = readFavoriteEntries(scope)
	if (hasFavoriteEntry(current, id) === favorite) return
	const next = favorite ? addFavoriteEntry(current, id, now) : removeFavoriteEntry(current, id)
	const key = getFavoritesStorageKey(scope)
	favoritesCache.set(key, next)
	writeStorageItem(key, next)
	notifyListeners()
}

export type DownloadedEntityStore<T> = Readonly<{
	read: (scope: LocalEntityScope) => DownloadedEntry<T>[]
	record: (scope: LocalEntityScope, items: readonly DownloadedItem<T>[], now?: number) => void
}>

/** One store per entity shape, so cached entries keep their decoded type without re-validating on every render. */
export function createDownloadedEntityStore<T>(decode: (data: unknown) => T | undefined, limit = DOWNLOADED_LIMIT): DownloadedEntityStore<T> {
	const cache = new Map<string, DownloadedEntry<T>[]>()
	cacheResetters.add(() => cache.clear())
	const read = (scope: LocalEntityScope) => {
		syncCachesWithStorage()
		const key = getDownloadedStorageKey(scope)
		const cached = cache.get(key)
		if (cached !== undefined) return cached
		const entries = parseDownloadedEntries(readStorageItem(key), decode)
		cache.set(key, entries)
		return entries
	}
	const record = (scope: LocalEntityScope, items: readonly DownloadedItem<T>[], now = Date.now()) => {
		if (items.length === 0) return
		const key = getDownloadedStorageKey(scope)
		const protectedIds = new Set(readFavoriteEntries(scope).map(entry => entry.id))
		const next = upsertDownloadedEntries(read(scope), items, now, protectedIds, limit)
		cache.set(key, next)
		if (!writeStorageItem(key, next)) writeStorageItem(key, next.slice(0, Math.max(1, Math.floor(next.length / 2))))
		notifyListeners()
	}
	return { read, record }
}

export function resetLocalEntityStoreForTesting() {
	for (const reset of cacheResetters) reset()
	listeners.clear()
	storageListenerInstalled = false
}
