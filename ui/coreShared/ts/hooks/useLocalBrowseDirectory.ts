import { useEffect, useRef, useState } from 'preact/hooks'
import { buildLocalBrowseEntries, normalizeLocalSearchText, type LocalBrowseCollection } from '../lib/localEntityBrowse.js'
import type { DownloadedEntityStore, DownloadedItem, LocalEntityApp, LocalEntityKind } from '../lib/localEntityStore.js'
import { useDownloadedEntities, useFavorites } from './useLocalEntities.js'
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
	/** Items of the last scanned page as the caller refreshes it; each new array is recorded once a scan has run. */
	refreshedItems?: readonly TItem[] | undefined
}

/**
 * Browsing runs over entities already downloaded to this browser: favorites by default, every downloaded summary on
 * request. Scanning the chain is an explicit, paged action whose results join the downloaded cache.
 */
export function useLocalBrowseDirectory<TItem, TData>({ app, contextKey, externalLoading = false, kind, loadPage, pageSize, receivedPage, refreshedItems, store, toDownloadedItem }: LocalBrowseDirectoryOptions<TItem, TData>) {
	const [collection, setCollection] = useState<LocalBrowseCollection>('favorites')
	const [searchText, setSearchText] = useState('')
	const favorites = useFavorites(app, kind)
	const downloaded = useDownloadedEntities(app, kind, store)
	const discovery = usePagedDiscovery({
		contextKey,
		loadPage,
		onItems: items => downloaded.record(items.map(toDownloadedItem)),
		pageSize,
		receivedPage,
	})
	// Only a new page (a completed scan or a refresh) is recorded; the recorder is read through a ref.
	const recordRefreshedItemsRef = useRef(() => {})
	recordRefreshedItemsRef.current = () => {
		if (refreshedItems !== undefined) downloaded.record(refreshedItems.map(toDownloadedItem))
	}
	useEffect(() => {
		if (discovery.hasScanned) recordRefreshedItemsRef.current()
	}, [refreshedItems, discovery.hasScanned])
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
