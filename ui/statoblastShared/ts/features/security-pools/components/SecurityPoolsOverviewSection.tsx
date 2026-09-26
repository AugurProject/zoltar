import { formatSecurityPoolPageSummary } from '../lib/securityPoolLabels.js'
import { PoolDirectoryRow } from './PoolDirectoryRow.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useMemo, useState } from 'preact/hooks'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { DiscoveryControl, LocalCollectionSwitcher } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { useDownloadedEntities, useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { usePagedDiscovery, type DiscoveredPage } from '@zoltar/ui-core-shared/hooks/usePagedDiscovery.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { buildLocalBrowseEntries, normalizeLocalSearchText, type LocalBrowseCollection } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
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
	onSelectSecurityPool,
	securityPoolPage,
	securityPoolOverviewError,
	repPerEthPrice,
	uiPriceOracle = 'open-oracle',
}: SecurityPoolsOverviewSectionProps) {
	const [collection, setCollection] = useState<LocalBrowseCollection>('favorites')
	const [searchText, setSearchText] = useState('')
	const [stateFilter, setStateFilter] = useState<PoolStateFilter>('all')
	const [sortKey, setSortKey] = useState<PoolSortKey>('recent')
	const favorites = useFavorites('statoblast', 'pool')
	const downloaded = useDownloadedEntities('statoblast', 'pool', securityPoolDownloadStore)
	const scopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const receivedPage = useMemo((): DiscoveredPage<ListedSecurityPool> | undefined => {
		if (securityPoolPage === undefined) return undefined
		return { items: securityPoolPage.pools, pageIndex: securityPoolPage.pageIndex, pageSize: securityPoolPage.pageSize, requestKey: securityPoolPage.requestKey, totalCount: securityPoolPage.poolCount }
	}, [securityPoolPage])
	const discovery = usePagedDiscovery({
		contextKey: `${environmentRefreshKey.toString()}:${scopedAccountAddress?.toLowerCase() ?? 'no-account'}`,
		loadPage: (pageIndex, requestKey) => onLoadSecurityPoolPage(pageIndex, SECURITY_POOL_PAGE_SIZE, requestKey),
		onItems: pools => downloaded.record(pools.map(pool => ({ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress }))),
		pageSize: SECURITY_POOL_PAGE_SIZE,
		receivedPage,
	})
	const discoveryLoading = discovery.loading || loadingSecurityPoolPage
	const discover = () => {
		setCollection('downloaded')
		discovery.discoverNext()
	}
	const favoriteEntries = buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'favorites')
	const collectionEntries = collection === 'favorites' ? favoriteEntries : buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'downloaded')
	const rows = derivePoolBrowseRows(collectionEntries, { currentTimestamp, repPerEthPrice, uiPriceOracle })
	const normalizedSearchText = normalizeLocalSearchText(searchText)
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
		if (rows.length === 0) {
			if (collection === 'favorites' && downloaded.entries.length > 0)
				return (
					<EmptyState
						title={securityPoolCopy.noFavoritePools}
						detail={securityPoolCopy.noFavoritePoolsWithDownloadsDetail}
						actions={
							<>
								{openSearchedAddress}
								<button className='secondary' type='button' onClick={() => setCollection('downloaded')}>
									{securityPoolCopy.showDownloadedPools}
								</button>
							</>
						}
					/>
				)
			if (discovery.hasScanned && discovery.totalCount === 0n)
				return (
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
				)
			if (collection === 'favorites') return <EmptyState title={securityPoolCopy.noFavoritePools} detail={securityPoolCopy.noFavoritePoolsDetail} actions={openSearchedAddress} />
			return <EmptyState title={securityPoolCopy.noDownloadedPools} detail={securityPoolCopy.noDownloadedPoolsDetail} actions={openSearchedAddress} />
		}
		if (visibleRows.length === 0) return <EmptyState title={commonCopy.noMatches} detail={securityPoolCopy.poolFiltersEmpty} actions={openSearchedAddress} />
		return (
			<div className='comparison-record-list'>
				{visibleRows.map(row => (
					<PoolDirectoryRow key={row.pool.securityPoolAddress} pool={row.pool} lifecycleState={row.lifecycleState} capacity={row.capacity} currentTimestamp={currentTimestamp} fetchedAt={row.fetchedAt} onSelect={onSelectSecurityPool} />
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
			<ErrorNotice message={securityPoolOverviewError ?? (discovery.loadFailed ? securityPoolCopy.poolPageLoadError : undefined)} />
			{securityPoolOverviewError === undefined && !discovery.loadFailed ? undefined : (
				<div className='actions pool-registry-recovery-actions'>
					<button className='secondary' type='button' onClick={discovery.retry} disabled={discoveryLoading}>
						{discoveryLoading ? <LoadingText>{securityPoolCopy.retryingSecurityPoolsTruncated}</LoadingText> : securityPoolCopy.retryLoadingPools}
					</button>
				</div>
			)}
			<div className='local-browse-bar'>
				<LocalCollectionSwitcher collection={collection} downloadedCount={downloaded.entries.length} favoritesCount={favoriteEntries.length} onChange={setCollection} />
				<DiscoveryControl discovery={{ ...discovery, discoverNext: discover, loading: discoveryLoading }} discoverLabel={securityPoolCopy.discoverPools} emphasize={downloaded.entries.length === 0} nounPlural={securityPoolCopy.poolCountPlural} />
			</div>
			<div className='filter-toolbar pool-browse-toolbar'>
				<label className='field'>
					<span>{securityPoolCopy.searchDownloadedPools}</span>
					<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={securityPoolCopy.poolSearchPlaceholder} />
				</label>
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
