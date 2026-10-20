import { formatSecurityPoolPageSummary, getPoolStateLabel } from '../lib/securityPoolLabels.js'
import { PoolDirectoryRow } from './PoolDirectoryRow.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useMemo, useState } from 'preact/hooks'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { LocalBrowseBar, LocalBrowseSearchField, LocalCollectionEmptyState } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { useLocalBrowseDirectory } from '@zoltar/ui-core-shared/hooks/useLocalBrowseDirectory.js'
import type { DiscoveredPage } from '@zoltar/ui-core-shared/hooks/usePagedDiscovery.js'
import { normalizeLocalSearchText } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { derivePoolBrowseRows, filterPoolBrowseRows, SECURITY_POOL_PAGE_SIZE, securityPoolDownloadStore, sortPoolBrowseRows, toCachedSecurityPool, type PoolSortKey, type PoolStateFilter } from '../lib/poolBrowse.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'
import type { SecurityPoolsOverviewSectionProps } from '../../types.js'

const STATE_FILTER_OPTIONS: readonly PoolStateFilter[] = ['all', 'operational', 'ended', 'forkMigration', 'forkTruthAuction']
const SORT_OPTIONS: readonly PoolSortKey[] = ['recent', 'remainingCapacity', 'endTime', 'state']

function getStateFilterLabel(filter: PoolStateFilter) {
	return filter === 'all' ? securityPoolCopy.allStates : getPoolStateLabel(filter)
}

function getSortLabel(sortKey: PoolSortKey) {
	if (sortKey === 'recent') return favoritesCopy.recentlySaved
	if (sortKey === 'remainingCapacity') return securityPoolCopy.remainingCapacity
	if (sortKey === 'endTime') return commonCopy.endTime
	return securityPoolCopy.systemState
}

function parseOption<TValue extends string>(options: readonly TValue[], value: string) {
	return options.find(option => option === value)
}

/** Pools discovered from the factory registry (the first page loads on entry) and favorites saved in this browser, searchable together. */
export function SecurityPoolsOverviewSection({ browseState, onBrowseStateChange, activeUniverseId, currentTimestamp, discovery: poolDiscovery, onCreatePool, onSelectSecurityPool }: SecurityPoolsOverviewSectionProps) {
	const [localStateFilter, setLocalStateFilter] = useState<PoolStateFilter>('all')
	const [localSortKey, setLocalSortKey] = useState<PoolSortKey>('recent')
	const [localSearchText, setLocalSearchText] = useState('')
	const stateFilter = browseState?.stateFilter ?? localStateFilter
	const sortKey = browseState?.sortKey ?? localSortKey
	const searchText = browseState?.searchText ?? localSearchText
	const setStateFilter = (value: PoolStateFilter) => (onBrowseStateChange === undefined ? setLocalStateFilter(value) : onBrowseStateChange({ stateFilter: value }))
	const setSortKey = (value: PoolSortKey) => (onBrowseStateChange === undefined ? setLocalSortKey(value) : onBrowseStateChange({ sortKey: value }))
	const setSearchText = (value: string) => (onBrowseStateChange === undefined ? setLocalSearchText(value) : onBrowseStateChange({ searchText: value }))
	const receivedPage = useMemo((): DiscoveredPage<ListedSecurityPool> | undefined => {
		const page = poolDiscovery.page
		if (page === undefined) return undefined
		return { items: page.pools, pageIndex: page.pageIndex, pageSize: page.pageSize, requestKey: page.requestKey, totalCount: page.poolCount }
	}, [poolDiscovery.page])
	const directory = useLocalBrowseDirectory({
		app: 'statoblast',
		contextKey: poolDiscovery.contextKey,
		externalLoading: poolDiscovery.loading,
		kind: 'pool',
		loadPage: (pageIndex, requestKey) => poolDiscovery.onLoadPage(pageIndex, SECURITY_POOL_PAGE_SIZE, requestKey),
		pageSize: SECURITY_POOL_PAGE_SIZE,
		receivedPage,
		store: securityPoolDownloadStore,
		toDownloadedItem: pool => ({ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress }),
	})
	const { discovery, downloaded } = directory
	const normalizedSearchText = normalizeLocalSearchText(searchText)
	const rows = derivePoolBrowseRows(directory.entries)
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

	const loadError = poolDiscovery.error ?? (discovery.loadFailed ? securityPoolCopy.poolPageLoadError : undefined)
	const content = (() => {
		// While a registry page loads, or after it failed, the bar and the retry notice explain an empty download list; a pasted address can still open.
		if (rows.length === 0 && directory.collection === 'downloaded' && (discovery.loading || loadError !== undefined)) return openSearchedAddress === undefined ? undefined : <div className='actions'>{openSearchedAddress}</div>
		if (rows.length === 0)
			return (
				<LocalCollectionEmptyState
					action={openSearchedAddress}
					copy={{
						downloadedEmpty: securityPoolCopy.noDownloadedPools,
						favoritesEmpty: securityPoolCopy.noFavoritePools,
						favoritesEmptyDetail: securityPoolCopy.noFavoritePoolsDetail,
						favoritesEmptyWithDownloadsDetail: securityPoolCopy.noFavoritePoolsWithDownloadsDetail,
						showDownloaded: securityPoolCopy.showDownloadedPools,
					}}
					directory={directory}
					registryEmpty={
						<EmptyState
							title={securityPoolCopy.noSecurityPools}
							detail={securityPoolCopy.noSecurityPoolsDetail}
							actions={
								<>
									{openSearchedAddress}
									{onCreatePool === undefined ? undefined : (
										<button className={openSearchedAddress === undefined ? 'primary' : 'secondary'} type='button' onClick={onCreatePool}>
											{commonCopy.createPool}
										</button>
									)}
								</>
							}
						/>
					}
				/>
			)
		if (visibleRows.length === 0) return <EmptyState title={commonCopy.noMatches} detail={securityPoolCopy.poolFiltersEmpty} actions={openSearchedAddress} />
		return (
			<div className='comparison-record-list'>
				{visibleRows.map(row => (
					<PoolDirectoryRow key={row.pool.securityPoolAddress} pool={row.pool} lifecycleState={row.lifecycleState} currentTimestamp={currentTimestamp} fetchedAt={row.fetchedAt} onSelect={onSelectSecurityPool} />
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
			<LocalBrowseBar directory={directory} nounPlural={securityPoolCopy.poolCountPlural} />
			<RetryableNotice disabled={discovery.loading} message={loadError} onRetry={discovery.retry} retryLabel={discovery.loading ? commonCopy.retrying : commonCopy.retry} />
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
