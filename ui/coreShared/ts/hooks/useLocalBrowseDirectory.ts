import { useEffect, useRef, useState } from 'preact/hooks'
import { buildLocalBrowseEntries, normalizeLocalSearchText, type LocalBrowseCollection } from '../lib/localEntityBrowse.js'
import type { DownloadedEntityStore, DownloadedItem, LocalEntityApp, LocalEntityKind } from '../lib/localEntityStore.js'
import { getLocalEntityScope, useDownloadedEntities, useFavorites } from './useLocalEntities.js'
import { usePagedDiscovery, type DiscoveredPage } from './usePagedDiscovery.js'

type LocalBrowseDirectoryOptions<TItem, TData> = {
	app: LocalEntityApp
	kind: LocalEntityKind
	store: DownloadedEntityStore<TData>
	toDownloadedItem: (item: TItem) => DownloadedItem<TData>
	/** Changing the context (network, account, environment) restarts the scan from the first page. */
	contextKey: string
	loadPage: (pageIndex: number, requestKey: string) => Promise<unknown> | void
	pageSize: number
	receivedPage: DiscoveredPage<TItem> | undefined
	/** A page load the caller tracks outside the scan, such as a block refresh of the last scanned page. */
	externalLoading?: boolean
	/** The last scanned page as the caller refreshes it; each new page is recorded once a scan has run. */
	refreshedPage?: DiscoveredPage<TItem> | undefined
}

/**
 * Browsing runs over entities already downloaded to this browser: favorites when available, or downloaded summaries otherwise. The first registry page loads automatically; additional pages join the downloaded cache on request.
 */
export function useLocalBrowseDirectory<TItem, TData>({ app, contextKey, externalLoading = false, kind, loadPage, pageSize, receivedPage, refreshedPage, store, toDownloadedItem }: LocalBrowseDirectoryOptions<TItem, TData>) {
	const [searchText, setSearchText] = useState('')
	const favorites = useFavorites(app, kind)
	const downloaded = useDownloadedEntities(app, kind, store)
	const [collection, setCollection] = useState<LocalBrowseCollection>(() => (favorites.entries.length > 0 ? 'favorites' : 'downloaded'))
	// A registry page is authoritative for its positions, so cached entries a reorganization removed or replaced are dropped.
	const recordPage = (page: DiscoveredPage<TItem>) => {
		const startIndex = page.pageIndex * page.pageSize
		const items = page.items.map((item, offset) => ({ ...toDownloadedItem(item), registryIndex: startIndex + offset }))
		store.recordRegistryPage(getLocalEntityScope(app, kind), { ids: items.map(item => item.id), startIndex, totalCount: page.totalCount }, items)
	}
	const discovery = usePagedDiscovery({
		contextKey,
		loadPage,
		onPage: recordPage,
		pageSize,
		receivedPage,
	})
	// Only a new page (a completed scan or a refresh) is recorded; the recorder is read through a ref.
	const recordRefreshedPageRef = useRef(() => {})
	recordRefreshedPageRef.current = () => {
		if (refreshedPage !== undefined) {
			discovery.updateTotalCount(refreshedPage.totalCount)
			recordPage(refreshedPage)
		}
	}
	useEffect(() => {
		if (discovery.hasScanned) recordRefreshedPageRef.current()
	}, [refreshedPage, discovery.hasScanned])
	const discoverNext = () => {
		setCollection('downloaded')
		discovery.discoverNext()
	}
	const favoriteEntries = buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'favorites')
	return {
		collection,
		discovery: { ...discovery, discoverNext, loading: discovery.loading || externalLoading },
		downloaded,
		entries: collection === 'favorites' ? favoriteEntries : buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'downloaded'),
		favoriteEntries,
		favorites,
		normalizedSearchText: normalizeLocalSearchText(searchText),
		searchText,
		setCollection,
		setSearchText,
	}
}
