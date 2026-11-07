import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { SkeletonList } from '@zoltar/ui-core-shared/components/Skeleton.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import * as appCopy from '../copy/app.js'
import { liveCopy } from '../copy/live.js'
import { marketsCopy } from '../copy/markets.js'
import { arrangeMarkets, type MarketFilter, type MarketListOptions, type MarketSort } from '../lib/marketListing.js'
import { DEFAULT_MARKET_LIST_OPTIONS, readMarketListParams, replaceRouteHashSearch, writeMarketListParams } from '../lib/routeState.js'
import { getTradingRouteHref, tradingListKindFor, type TradingListKind, type TradingLookupRoute } from '../lib/routing.js'
import { findSecurityPoolGuideHref } from '../lib/docsLinks.js'
import type { LiveMarket } from '../protocol/live.js'
import type { MarketRegistry } from './live/useMarketRegistry.js'
import { MarketCard } from './MarketCard.js'

const FILTER_OPTIONS: readonly { value: MarketFilter; label: string }[] = [
	{ value: 'all', label: marketsCopy.filterAll },
	{ value: 'open', label: marketsCopy.filterOpen },
	{ value: 'closing-soon', label: marketsCopy.closingSoon },
	{ value: 'resolved', label: marketsCopy.resolved },
]

const SORT_OPTIONS: readonly { value: MarketSort; label: string }[] = [
	{ value: 'closing-soon', label: marketsCopy.closingSoon },
	{ value: 'liquidity', label: marketsCopy.liquidity },
	{ value: 'recent', label: favoritesCopy.recentlySaved },
]

const poolListPresentation = { empty: liveCopy.noFavoritePools, emptyDetail: liveCopy.noFavoritePoolsDetail, guide: { href: findSecurityPoolGuideHref, label: liveCopy.findSecurityPoolGuide } }

/** A pasted security pool address opens that pool in the lookup route's workflow, whether or not it is among the downloaded markets. */
function searchedPoolAddress(query: string) {
	const parsed = tryParseAddressInput(query.trim())
	return parsed === undefined || parsed === zeroAddress ? undefined : parsed
}

/**
 * Search (which also opens a pasted pool address) and sort share the first row; the status filter leads the second.
 * The open action stays in place: submitting anything but a full pool address explains what the field needs.
 */
function MarketSearchRow({ options, arrangeable, lookupRoute, onChange }: { options: MarketListOptions; arrangeable: boolean; lookupRoute: TradingLookupRoute; onChange(next: MarketListOptions): void }) {
	const address = searchedPoolAddress(options.query)
	const [submittedInvalidQuery, setSubmittedInvalidQuery] = useState<string>()
	const addressError = submittedInvalidQuery !== undefined && submittedInvalidQuery === options.query ? liveCopy.poolAddressRequired : undefined
	return (
		<div className='market-list-controls' role='group' aria-label={marketsCopy.listControls}>
			<form
				className='field market-list-search'
				role='search'
				onSubmit={event => {
					event.preventDefault()
					if (address === undefined) {
						setSubmittedInvalidQuery(options.query)
						return
					}
					window.location.hash = getTradingRouteHref(`#/${lookupRoute}/${address}`)
				}}
			>
				<div className='market-list-search__field'>
					<FormInput type='search' aria-label={lookupRoute === 'create-market' ? marketsCopy.searchPoolsLabel : marketsCopy.searchLabel} placeholder={marketsCopy.searchPlaceholder} value={options.query} error={addressError} liveError onInput={event => onChange({ ...options, query: event.currentTarget.value })} />
				</div>
				<button className='primary' type='submit'>
					{liveCopy.openSecurityPool}
				</button>
			</form>
			{arrangeable ? (
				<div className='market-list-sort'>
					<span className='metric-label' aria-hidden='true'>
						{marketsCopy.sortLabel}
					</span>
					<EnumDropdown
						ariaLabel={marketsCopy.sortLabel}
						value={options.sort}
						options={lookupRoute === 'create-market' ? SORT_OPTIONS.filter(option => option.value !== 'liquidity') : SORT_OPTIONS}
						onChange={sort => {
							onChange({ ...options, sort })
						}}
					/>
				</div>
			) : undefined}
		</div>
	)
}

function MarketCardList({ markets, listKind, lookupRoute, nowSeconds, fetchedAtByPool }: { fetchedAtByPool?: ReadonlyMap<string, number> | undefined; markets: readonly LiveMarket[]; listKind: TradingListKind; lookupRoute: TradingLookupRoute; nowSeconds: bigint }) {
	return (
		<div className='entity-card-list market-list'>
			{markets.map(market => (
				<MarketCard key={market.pool} listKind={listKind} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} fetchedAt={fetchedAtByPool?.get(market.pool.toLowerCase())} />
			))}
		</div>
	)
}

function MarketListFilters({ options, shown, loaded, listKind, onChange }: { options: MarketListOptions; shown: number; loaded: number; listKind: TradingListKind; onChange(next: MarketListOptions): void }) {
	return (
		<div className='market-list-subbar'>
			<ViewTabs ariaLabel={marketsCopy.filterLabel} className='market-list-filters' semantics='switcher' size='compact' variant='segmented' value={options.filter} onChange={filter => onChange({ ...options, filter })} options={FILTER_OPTIONS.map(option => ({ ...option }))} />
			{shown === loaded ? undefined : (
				<p className='market-list-count' role='status'>
					{listKind === 'security-pools' ? marketsCopy.poolResultCount(shown, loaded) : marketsCopy.resultCount(shown, loaded)}
				</p>
			)}
		</div>
	)
}

function NoMatches({ onClear }: { onClear(): void }) {
	return (
		<EmptyState
			title={commonCopy.noMatches}
			actions={
				<button type='button' onClick={onClear}>
					{marketsCopy.clearFilters}
				</button>
			}
		/>
	)
}

/**
 * The market list: saved favorites lead, then the registry page of every other market in the universe, so a new
 * browser sees markets without an address. Favorites show the page's fresher copy when the page read them successfully.
 */
function RegistryMarketList({
	favorites,
	registry,
	loading,
	lookupRoute,
	options,
	nowSeconds,
	fetchedAtByPool,
	workflowLocked,
	onChange,
}: {
	favorites: readonly LiveMarket[]
	registry: MarketRegistry
	loading: boolean
	lookupRoute: TradingLookupRoute
	options: MarketListOptions
	nowSeconds: bigint
	fetchedAtByPool: ReadonlyMap<string, number> | undefined
	workflowLocked: boolean
	onChange(next: MarketListOptions): void
}) {
	// A failed read on the page leaves only a placeholder, so the saved copy stays on screen instead.
	const pageByPool = new Map(registry.markets.filter(market => market.loadError === undefined).map(market => [market.pool.toLowerCase(), market]))
	const favoritePools = new Set(favorites.map(market => market.pool.toLowerCase()))
	const shownFavorites = arrangeMarkets(
		favorites.map(market => pageByPool.get(market.pool.toLowerCase()) ?? market),
		options,
		nowSeconds,
	)
	const others = registry.markets.filter(market => !favoritePools.has(market.pool.toLowerCase()))
	const shownOthers = arrangeMarkets(others, options, nowSeconds)
	const loaded = favorites.length + others.length
	const shown = shownFavorites.length + shownOthers.length
	const page = registry.page
	const loadingFirstRows = loading && others.length === 0
	let otherList: ComponentChildren
	if (loadingFirstRows) otherList = <SkeletonList label={marketsCopy.loadingMarkets} rows={2} />
	else if (shownOthers.length > 0) otherList = <MarketCardList markets={shownOthers} listKind='markets' lookupRoute={lookupRoute} nowSeconds={nowSeconds} />
	else if (registry.status === 'ready' && page !== undefined && page.total === 0n && favorites.length === 0)
		otherList = (
			<EmptyState
				title={marketsCopy.noMarketsInUniverse}
				detail={marketsCopy.noMarketsInUniverseDetail}
				actions={
					<a className='button-link secondary-link' href={getTradingRouteHref('#/create-market')}>
						{appCopy.createMarket}
					</a>
				}
			/>
		)
	// Favorites lead under their own heading; the rest of the universe follows under another once both are on screen.
	const headed = shownFavorites.length > 0 && (shownOthers.length > 0 || loadingFirstRows)
	return (
		<>
			{registry.status === 'error' ? <RetryableNotice message={liveCopy.describeDiscoveryFailure(marketsCopy.registryFailedLead, registry.error)} retryLabel={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={registry.retry} /> : undefined}
			{loaded > 0 ? <MarketListFilters options={options} shown={shown} loaded={loaded} listKind='markets' onChange={onChange} /> : undefined}
			{shownFavorites.length > 0 ? (
				<>
					<h3 className='eyebrow market-list-heading'>{favoritesCopy.formatCollectionTab(favoritesCopy.favorites, favorites.length)}</h3>
					<MarketCardList markets={shownFavorites} listKind='markets' lookupRoute={lookupRoute} nowSeconds={nowSeconds} fetchedAtByPool={fetchedAtByPool} />
				</>
			) : undefined}
			{headed ? <h3 className='eyebrow market-list-heading'>{marketsCopy.otherMarkets}</h3> : undefined}
			{otherList}
			{loaded > 0 && shown === 0 ? <NoMatches onClear={() => onChange(DEFAULT_MARKET_LIST_OPTIONS)} /> : undefined}
			{page === undefined ? undefined : (
				<PaginationControls
					hasNextPage={page.nextStart !== undefined}
					hasPreviousPage={page.previousStart !== undefined}
					loading={loading}
					summary={registry.markets.length === 0 ? undefined : marketsCopy.pageRange(page.start + 1n, page.start + BigInt(registry.markets.length), page.total)}
					onPreviousPage={() => {
						if (page.previousStart !== undefined) registry.loadPage(page.previousStart)
					}}
					onNextPage={() => {
						if (page.nextStart !== undefined) registry.loadPage(page.nextStart)
					}}
				/>
			)}
		</>
	)
}

/**
 * The lookup landings: search with direct address lookup above the list of the workflow's candidates. Market lists
 * page through the registry with favorites first; the security-pool list holds the pools saved in this browser.
 */
export function LiveMarketBrowser({
	lookupRoute,
	markets,
	registry,
	fetchedAtByPool,
	discoveryState,
	discoveryError,
	workflowLocked,
	nowSeconds,
	retry,
}: {
	lookupRoute: TradingLookupRoute
	fetchedAtByPool?: ReadonlyMap<string, number> | undefined
	/** Saved favorites in the selected universe: markets on the market lists, pools without a market on the creation list. */
	markets: readonly LiveMarket[]
	/** The registry page a market list browses; the security-pool list has none. */
	registry: MarketRegistry | undefined
	discoveryState: 'loading' | 'ready' | 'error' | 'not-found'
	discoveryError: string | undefined
	workflowLocked: boolean
	nowSeconds: bigint
	retry(): void
}) {
	const listKind = tradingListKindFor(lookupRoute) ?? 'markets'
	const persistsListOptions = listKind === 'markets'
	// The market list's search, filter, and sort live in the hash query, so Back and refresh restore them.
	const [listOptions, setStoredListOptions] = useState(() => (persistsListOptions ? readMarketListParams(parseRouteHash(window.location.hash).search) : DEFAULT_MARKET_LIST_OPTIONS))
	const setListOptions = (next: MarketListOptions) => {
		setStoredListOptions(next)
		if (persistsListOptions) replaceRouteHashSearch(search => writeMarketListParams(search, next), `#/${lookupRoute}`)
	}
	const discoveryNotice = discoveryState === 'error' ? <RetryableNotice message={liveCopy.securityPoolDiscoveryFailed(discoveryError)} retryLabel={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} /> : undefined
	if (registry !== undefined) {
		// Without a universe the registry is idle: it waits while discovery names one and shows nothing once discovery fails.
		const loading = registry.status === 'loading' || (registry.status === 'idle' && discoveryState === 'loading')
		return (
			<SectionBlock className='market-browser' variant='plain' busy={loading}>
				<MarketSearchRow options={listOptions} arrangeable={markets.length > 0 || registry.markets.length > 0} lookupRoute={lookupRoute} onChange={setListOptions} />
				{discoveryNotice}
				<RegistryMarketList favorites={markets} registry={registry} loading={loading} lookupRoute={lookupRoute} options={listOptions} nowSeconds={nowSeconds} fetchedAtByPool={fetchedAtByPool} workflowLocked={workflowLocked} onChange={setListOptions} />
			</SectionBlock>
		)
	}
	const presentation = poolListPresentation
	const shownMarkets = arrangeMarkets(markets, listOptions, nowSeconds)
	let list: ComponentChildren
	if (markets.length === 0)
		list = (
			<EmptyState
				title={presentation.empty}
				detail={presentation.emptyDetail}
				actions={
					<a className='button-link secondary-link' href={presentation.guide.href} target='_blank' rel='noreferrer'>
						{presentation.guide.label}
					</a>
				}
			/>
		)
	else if (shownMarkets.length === 0) list = <NoMatches onClear={() => setListOptions(DEFAULT_MARKET_LIST_OPTIONS)} />
	else list = <MarketCardList markets={shownMarkets} listKind={listKind} lookupRoute={lookupRoute} nowSeconds={nowSeconds} fetchedAtByPool={fetchedAtByPool} />
	return (
		<SectionBlock className='market-browser' variant='plain'>
			<p className='detail'>{favoritesCopy.formatCollectionTab(favoritesCopy.favorites, markets.length)}</p>
			<MarketSearchRow options={listOptions} arrangeable={markets.length > 0} lookupRoute={lookupRoute} onChange={setListOptions} />
			{discoveryNotice}
			{markets.length > 0 ? <MarketListFilters options={listOptions} shown={shownMarkets.length} loaded={markets.length} listKind={listKind} onChange={setListOptions} /> : undefined}
			{list}
		</SectionBlock>
	)
}
