import { formatSecurityPoolPageSummary } from '../lib/securityPoolLabels.js'
import { PoolDirectoryRow } from './PoolDirectoryRow.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useMemo, useState } from 'preact/hooks'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { LocalBrowseBar, LocalBrowseSearchField, LocalCollectionEmptyState } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { useLocalBrowseDirectory } from '@zoltar/ui-core-shared/hooks/useLocalBrowseDirectory.js'
import type { DiscoveredPage } from '@zoltar/ui-core-shared/hooks/usePagedDiscovery.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { getWalletScopedAccountAddress } from '@zoltar/ui-core-shared/wallet/network.js'
import { SECURITY_POOL_PAGE_SIZE } from '@zoltar/ui-core-shared/lib/pagination.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { derivePoolBrowseRows, filterPoolBrowseRows, securityPoolDownloadStore, sortPoolBrowseRows, toCachedSecurityPool, type PoolSortKey, type PoolStateFilter } from '../lib/poolBrowse.js'
import type { SecurityPoolsOverviewSectionProps } from '../../types.js'

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
 * Pool browsing runs over pools already downloaded to this browser: favorites by default, every downloaded summary
 * on request. Scanning the chain is an explicit, paged action whose results join the downloaded cache.
 */
export function SecurityPoolsOverviewSection({
	accountState,
	activeUniverseId,
	currentTimestamp,
	environmentRefreshKey,
	loadingSecurityPoolPage,
	onCreateSecurityPool,
	onLoadSecurityPoolPage,
	onRefreshSecurityPoolPage,
	onSelectSecurityPool,
	securityPoolPage,
	securityPoolPageFreshness,
	securityPoolOverviewError,
}: SecurityPoolsOverviewSectionProps) {
	const [stateFilter, setStateFilter] = useState<PoolStateFilter>('all')
	const [sortKey, setSortKey] = useState<PoolSortKey>('recent')
	const scopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const receivedPage = useMemo((): DiscoveredPage<ListedSecurityPool> | undefined => {
		if (securityPoolPage === undefined) return undefined
		return { items: securityPoolPage.pools, pageIndex: securityPoolPage.pageIndex, pageSize: securityPoolPage.pageSize, requestKey: securityPoolPage.requestKey, totalCount: securityPoolPage.poolCount }
	}, [securityPoolPage])
	const discoveryContextKey = `${environmentRefreshKey.toString()}:${scopedAccountAddress?.toLowerCase() ?? 'no-account'}`
	const directory = useLocalBrowseDirectory({
		app: 'statoblast',
		contextKey: discoveryContextKey,
		externalLoading: loadingSecurityPoolPage,
		kind: 'pool',
		loadPage: (pageIndex, requestKey) => onLoadSecurityPoolPage(pageIndex, SECURITY_POOL_PAGE_SIZE, requestKey),
		pageSize: SECURITY_POOL_PAGE_SIZE,
		receivedPage,
		refreshedItems: securityPoolPage === undefined || !securityPoolPage.requestKey.startsWith(`${discoveryContextKey}:`) ? undefined : securityPoolPage.pools,
		store: securityPoolDownloadStore,
		toDownloadedItem: pool => ({ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress }),
	})
	const { discovery, downloaded, normalizedSearchText, searchText } = directory
	// Once the user has scanned, the last scanned page (one bounded read) refreshes on new blocks and keeps its cached pools current.
	useBlockRefresh(() => onRefreshSecurityPoolPage?.(), onRefreshSecurityPoolPage !== undefined && discovery.hasScanned)
	const rows = derivePoolBrowseRows(directory.entries)
	const universeRows = rows.filter(row => row.pool.universeId === activeUniverseId)
	const visibleRows = sortPoolBrowseRows(filterPoolBrowseRows(rows, { activeUniverseId, normalizedSearchText, stateFilter }), sortKey, currentTimestamp)
	const otherUniverseCount = rows.length - universeRows.length
	const searchedAddress = isHexAddressInput(searchText.trim()) ? searchText.trim() : undefined
	// A pasted address that is not listed (not downloaded, in the other collection, or filtered out) can still be opened directly.
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
		if (rows.length === 0)
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
					registryEmpty={
						<EmptyState
							title={securityPoolCopy.noSecurityPools}
							actions={
								<>
									{openSearchedAddress}
									{onCreateSecurityPool === undefined ? undefined : (
										<button className={openSearchedAddress === undefined ? 'primary' : 'secondary'} type='button' onClick={onCreateSecurityPool}>
											{commonCopy.createSecurityPoolAction}
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
			<RetryableNotice
				actionsClassName='pool-registry-recovery-actions'
				disabled={discovery.loading}
				message={securityPoolOverviewError ?? (discovery.loadFailed ? securityPoolCopy.poolPageLoadError : undefined)}
				onRetry={discovery.retry}
				retryLabel={discovery.loading ? <LoadingText>{securityPoolCopy.retryingSecurityPoolsTruncated}</LoadingText> : securityPoolCopy.retryLoadingPools}
			/>
			<LocalBrowseBar directory={directory} discoverLabel={securityPoolCopy.discoverPools} freshness={securityPoolPageFreshness} nounPlural={securityPoolCopy.poolCountPlural} />
			<div className='filter-toolbar pool-browse-toolbar'>
				<LocalBrowseSearchField label={securityPoolCopy.searchDownloadedPools} onChange={directory.setSearchText} placeholder={securityPoolCopy.poolSearchPlaceholder} value={searchText} />
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
