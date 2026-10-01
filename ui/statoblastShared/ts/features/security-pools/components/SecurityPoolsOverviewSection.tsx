import { formatSecurityPoolPageSummary } from '../lib/securityPoolLabels.js'
import { PoolDirectoryRow } from './PoolDirectoryRow.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useEffect, useState } from 'preact/hooks'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { LocalBrowseBar, LocalBrowseSearchField, LocalCollectionEmptyState } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { useDownloadedEntities, useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { buildLocalBrowseEntries, normalizeLocalSearchText, type LocalBrowseCollection } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { derivePoolBrowseRows, filterPoolBrowseRows, securityPoolDownloadStore, sortPoolBrowseRows, toCachedSecurityPool, type PoolSortKey, type PoolStateFilter } from '../lib/poolBrowse.js'
import type { SecurityPoolsOverviewSectionProps } from '../../types.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'

/** The pool registry read that Discover pools runs; its pools are recorded as downloaded browse entries. */
type PoolDiscovery = {
	error: string | undefined
	loading: boolean
	onDiscover: () => void
	pools: readonly ListedSecurityPool[] | undefined
}

const STATE_FILTER_OPTIONS: readonly PoolStateFilter[] = ['all', 'operational', 'ended', 'poolForked', 'forkMigration', 'forkTruthAuction']
const SORT_OPTIONS: readonly PoolSortKey[] = ['recent', 'remainingCapacity', 'endTime', 'state']

function getStateFilterLabel(filter: PoolStateFilter) {
	if (filter === 'all') return securityPoolCopy.allStates
	if (filter === 'operational') return commonCopy.operational
	if (filter === 'ended') return securityPoolCopy.ended
	if (filter === 'poolForked') return securityPoolCopy.poolForked
	if (filter === 'forkMigration') return securityPoolCopy.forkMigration
	return commonCopy.truthAuction
}

function getSortLabel(sortKey: PoolSortKey) {
	if (sortKey === 'recent') return favoritesCopy.recentlySaved
	if (sortKey === 'remainingCapacity') return securityPoolCopy.remainingCapacity
	if (sortKey === 'endTime') return favoritesCopy.endTime
	return securityPoolCopy.systemState
}

function parseOption<TValue extends string>(options: readonly TValue[], value: string) {
	return options.find(option => option === value)
}

/**
 * The pool directory browses pools saved in this browser: favorites by default, every downloaded pool on request.
 * Discover pools reads the active universe's pools from the registry and records them as downloaded entries.
 */
export function SecurityPoolsOverviewSection({ browseState, discovery, onBrowseStateChange, activeUniverseId, currentTimestamp, onSelectSecurityPool }: SecurityPoolsOverviewSectionProps & { discovery?: PoolDiscovery | undefined }) {
	const [collection, setCollection] = useState<LocalBrowseCollection>('favorites')
	// Discovery is opt-in: only a registry read the user asked for here is recorded, and later refreshes of it stay recorded.
	const [discoveryRequested, setDiscoveryRequested] = useState(false)
	const [recordedPools, setRecordedPools] = useState<readonly ListedSecurityPool[] | undefined>(undefined)
	const [localStateFilter, setLocalStateFilter] = useState<PoolStateFilter>('all')
	const [localSortKey, setLocalSortKey] = useState<PoolSortKey>('recent')
	const [localSearchText, setLocalSearchText] = useState('')
	const stateFilter = browseState?.stateFilter ?? localStateFilter
	const sortKey = browseState?.sortKey ?? localSortKey
	const searchText = browseState?.searchText ?? localSearchText
	const setStateFilter = (value: PoolStateFilter) => (onBrowseStateChange === undefined ? setLocalStateFilter(value) : onBrowseStateChange({ stateFilter: value }))
	const setSortKey = (value: PoolSortKey) => (onBrowseStateChange === undefined ? setLocalSortKey(value) : onBrowseStateChange({ sortKey: value }))
	const setSearchText = (value: string) => (onBrowseStateChange === undefined ? setLocalSearchText(value) : onBrowseStateChange({ searchText: value }))
	const favorites = useFavorites('statoblast', 'pool')
	const downloaded = useDownloadedEntities('statoblast', 'pool', securityPoolDownloadStore)
	const favoriteEntries = buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'favorites')
	const entries = collection === 'favorites' ? favoriteEntries : buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'downloaded')
	const discoveredPools = discovery?.pools
	const discoveryLoading = discovery?.loading === true
	useEffect(() => {
		if (!discoveryRequested || discoveredPools === undefined || discoveryLoading || discoveredPools === recordedPools) return
		downloaded.record(discoveredPools.filter(pool => pool.universeId === activeUniverseId).map(pool => ({ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress })))
		setRecordedPools(discoveredPools)
	}, [activeUniverseId, discoveredPools, discoveryLoading, discoveryRequested, recordedPools])
	const hasDiscovered = discoveryRequested && recordedPools !== undefined && discoveredPools !== undefined
	const discoveredUniversePoolCount = recordedPools === undefined ? 0n : BigInt(recordedPools.filter(pool => pool.universeId === activeUniverseId).length)
	const discoverPools = () => {
		setCollection('downloaded')
		setDiscoveryRequested(true)
		discovery?.onDiscover()
	}
	const directory = {
		collection,
		discovery: { discoverNext: discoverPools, hasMore: false, hasScanned: hasDiscovered, loading: discoveryLoading, scannedItemCount: discoveredUniversePoolCount, totalCount: hasDiscovered ? discoveredUniversePoolCount : undefined },
		downloaded,
		favoriteEntries,
		setCollection,
	}
	const discoveryFailed = discoveryRequested && discovery?.error !== undefined
	const normalizedSearchText = normalizeLocalSearchText(searchText)
	const rows = derivePoolBrowseRows(entries)
	const universeRows = rows.filter(row => row.pool.universeId === activeUniverseId)
	const visibleRows = sortPoolBrowseRows(filterPoolBrowseRows(rows, { activeUniverseId, normalizedSearchText, stateFilter }), sortKey, currentTimestamp)
	const otherUniverseCount = rows.length - universeRows.length
	const searchedAddress = isHexAddressInput(searchText.trim()) ? searchText.trim() : undefined
	// A pasted address that is not listed (not cached, not favorited, or filtered out) can still be opened directly.
	const searchedAddressIsListed = searchedAddress !== undefined && visibleRows.some(row => row.pool.securityPoolAddress.toLowerCase() === searchedAddress.toLowerCase())
	// A downloaded pool opens in its own universe, like its directory row.
	const searchedDownloadedPool = searchedAddress === undefined ? undefined : downloaded.entries.find(entry => entry.id === searchedAddress.toLowerCase())
	const openSearchedAddress =
		searchedAddress === undefined || searchedAddressIsListed || onSelectSecurityPool === undefined ? undefined : (
			<button className='primary' type='button' onClick={() => onSelectSecurityPool(searchedAddress, searchedDownloadedPool?.data.universeId ?? activeUniverseId)}>
				{securityPoolCopy.openPoolAtAddress}
			</button>
		)

	const content = (() => {
		if (universeRows.length === 0 && (rows.length === 0 || hasDiscovered))
			return (
				<LocalCollectionEmptyState
					action={openSearchedAddress}
					copy={{
						downloadedEmpty: securityPoolCopy.noDownloadedPools,
						downloadedEmptyDetail: securityPoolCopy.noDownloadedPoolsDetail,
						favoritesEmpty: securityPoolCopy.noFavoritePools,
						favoritesEmptyDetail: securityPoolCopy.noFavoritePoolsDetail,
						favoritesEmptyWithDownloadsDetail: securityPoolCopy.noFavoritePoolsWithDownloadsDetail,
						showDownloaded: securityPoolCopy.showDownloadedPools,
					}}
					directory={directory}
					registryEmpty={<EmptyState live title={commonCopy.none} detail={securityPoolCopy.noPoolsInUniverse} actions={openSearchedAddress} />}
				/>
			)
		if (visibleRows.length === 0) return <EmptyState title={commonCopy.noMatches} detail={securityPoolCopy.poolFiltersEmpty} actions={openSearchedAddress} />
		return (
			<div className='comparison-record-list'>
				{visibleRows.map(row => (
					<PoolDirectoryRow key={row.pool.securityPoolAddress} pool={row.pool} lifecycleState={row.lifecycleState} capacity={row.capacity} currentTimestamp={currentTimestamp} fetchedAt={row.fetchedAt} onSelect={onSelectSecurityPool} remainingCapacity={row.remainingCapacity} />
				))}
			</div>
		)
	})()
	const summary = (() => {
		const parts: string[] = []
		if (universeRows.length > 0 && visibleRows.length !== universeRows.length) parts.push(formatSecurityPoolPageSummary(visibleRows.length, universeRows.length))
		if (otherUniverseCount > 0) parts.push(securityPoolCopy.formatOtherUniversePoolsHidden(otherUniverseCount))
		return parts.length === 0 ? undefined : parts.join(' ')
	})()

	return (
		<SectionBlock density='compact' variant='plain'>
			{discovery === undefined ? (
				<p className='detail'>{favoritesCopy.formatCollectionTab(favoritesCopy.favorites, entries.length)}</p>
			) : (
				<>
					<RetryableNotice disabled={discoveryLoading} message={discoveryFailed ? securityPoolCopy.poolDiscoveryError : undefined} onRetry={discoverPools} retryLabel={discoveryLoading ? <LoadingText>{commonCopy.retrying}</LoadingText> : securityPoolCopy.retryPoolDiscovery} />
					<LocalBrowseBar directory={directory} discoverLabel={securityPoolCopy.discoverPools} nounPlural={securityPoolCopy.poolCountPlural} />
				</>
			)}
			<div className='filter-toolbar pool-browse-toolbar'>
				<LocalBrowseSearchField label={securityPoolCopy.searchPools} onChange={setSearchText} placeholder={securityPoolCopy.poolSearchPlaceholder} value={searchText} />
				<label className='field'>
					<span>{securityPoolCopy.systemState}</span>
					<select value={stateFilter} onChange={event => setStateFilter(parseOption(STATE_FILTER_OPTIONS, event.currentTarget.value) ?? 'all')}>
						{STATE_FILTER_OPTIONS.map(option => (
							<option key={option} value={option}>
								{getStateFilterLabel(option)}
							</option>
						))}
					</select>
				</label>
				<label className='field'>
					<span>{securityPoolCopy.sortPools}</span>
					<select value={sortKey} onChange={event => setSortKey(parseOption(SORT_OPTIONS, event.currentTarget.value) ?? 'recent')}>
						{SORT_OPTIONS.map(option => (
							<option key={option} value={option}>
								{getSortLabel(option)}
							</option>
						))}
					</select>
				</label>
			</div>
			{summary === undefined ? undefined : <p className='detail'>{summary}</p>}
			{content}
		</SectionBlock>
	)
}
