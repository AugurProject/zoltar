import { formatSecurityPoolPageSummary } from '../lib/securityPoolLabels.js'
import { PoolDirectoryRow } from './PoolDirectoryRow.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useState } from 'preact/hooks'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { LocalBrowseSearchField } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { useDownloadedEntities, useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { buildLocalBrowseEntries, normalizeLocalSearchText } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { derivePoolBrowseRows, filterPoolBrowseRows, securityPoolDownloadStore, sortPoolBrowseRows, type PoolSortKey, type PoolStateFilter } from '../lib/poolBrowse.js'
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

/** The pool directory shows only favorites saved in this browser. */
export function SecurityPoolsOverviewSection({ activeUniverseId, currentTimestamp, onSelectSecurityPool }: SecurityPoolsOverviewSectionProps) {
	const [stateFilter, setStateFilter] = useState<PoolStateFilter>('all')
	const [sortKey, setSortKey] = useState<PoolSortKey>('recent')
	const [searchText, setSearchText] = useState('')
	const favorites = useFavorites('statoblast', 'pool')
	const downloaded = useDownloadedEntities('statoblast', 'pool', securityPoolDownloadStore)
	const entries = buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'favorites')
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
		if (rows.length === 0) return <EmptyState title={securityPoolCopy.noFavoritePools} detail={securityPoolCopy.noFavoritePoolsDetail} actions={openSearchedAddress} />
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
			<p className='detail'>{favoritesCopy.formatCollectionTab(favoritesCopy.favorites, entries.length)}</p>
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
