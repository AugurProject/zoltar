import { useEffect, useRef, useState } from 'preact/hooks'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { getLocalEntityStoreRevision, hasFavoriteEntry, normalizeEntityId, readFavoriteEntries, setEntityFavorite, subscribeLocalEntityStore, type DownloadedEntityStore, type DownloadedItem, type LocalEntityApp, type LocalEntityKind, type LocalEntityScope } from '../lib/localEntityStore.js'

/** The active network decides the storage scope; simulation, Sepolia, and mainnet never share favorites. */
export function getLocalEntityScope(app: LocalEntityApp, kind: LocalEntityKind): LocalEntityScope {
	const profile = getActiveNetworkProfile()
	return { app, kind, network: `${profile.id}-${profile.chainIdHex.toLowerCase()}` }
}

function useLocalEntityStoreVersion() {
	const [, setRevision] = useState(getLocalEntityStoreRevision())
	const renderedRevision = getLocalEntityStoreRevision()
	const renderedRevisionRef = useRef(renderedRevision)
	renderedRevisionRef.current = renderedRevision
	useEffect(() => {
		const unsubscribe = subscribeLocalEntityStore(() => setRevision(getLocalEntityStoreRevision()))
		// Another component may have changed the store after this one rendered but before it subscribed.
		if (getLocalEntityStoreRevision() !== renderedRevisionRef.current) setRevision(getLocalEntityStoreRevision())
		return unsubscribe
	}, [])
}

export function useFavorites(app: LocalEntityApp, kind: LocalEntityKind) {
	useLocalEntityStoreVersion()
	const entries = readFavoriteEntries(getLocalEntityScope(app, kind))
	return {
		entries,
		isFavorite: (id: string) => hasFavoriteEntry(entries, id),
		setFavorite: (id: string, favorite: boolean) => setEntityFavorite(getLocalEntityScope(app, kind), id, favorite),
	}
}

export function useDownloadedEntities<T>(app: LocalEntityApp, kind: LocalEntityKind, store: DownloadedEntityStore<T>) {
	useLocalEntityStoreVersion()
	return {
		entries: store.read(getLocalEntityScope(app, kind)),
		record: (items: readonly DownloadedItem<T>[]) => store.record(getLocalEntityScope(app, kind), items),
	}
}

/**
 * Opening an entity favorites it once per visit and keeps its cached summary current, so the browse list can show it
 * without another chain scan. Later refreshes of the same entity only update the cache, so un-starring it sticks.
 */
export function useRememberOpenedEntity<T>(app: LocalEntityApp, kind: LocalEntityKind, store: DownloadedEntityStore<T>, id: string | undefined, data: T | undefined) {
	const favoritedIdRef = useRef<string | undefined>(undefined)
	useEffect(() => {
		if (id === undefined || data === undefined) {
			favoritedIdRef.current = undefined
			return
		}
		const scope = getLocalEntityScope(app, kind)
		store.record(scope, [{ id, data }])
		const normalizedId = normalizeEntityId(id)
		if (favoritedIdRef.current === normalizedId) return
		favoritedIdRef.current = normalizedId
		setEntityFavorite(scope, id, true)
	}, [app, data, id, kind, store])
}
