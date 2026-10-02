import { useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { DiscoveryControl } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import type { FavoriteEntry } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { RetryAction, RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { SkeletonList } from '@zoltar/ui-core-shared/components/Skeleton.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { liveCopy } from '../copy/live.js'
import { marketsCopy } from '../copy/markets.js'
import { partitionFavoriteMarkets } from '../lib/favoriteMarkets.js'
import { arrangeMarkets, type MarketFilter, type MarketListOptions, type MarketSort } from '../lib/marketListing.js'
import { getTradingRouteHref, tradingListKindFor, type TradingListKind, type TradingLookupRoute } from '../lib/routing.js'
import type { LiveMarket } from '../protocol/live.js'
import { MarketCard } from './MarketCard.js'
import { OpenPoolForm } from './OpenPoolForm.js'

const DEFAULT_LIST_OPTIONS: MarketListOptions = { filter: 'all', query: '', sort: 'closing-soon' }

const FILTER_OPTIONS: readonly { value: MarketFilter; label: string }[] = [
	{ value: 'all', label: marketsCopy.filterAll },
	{ value: 'open', label: marketsCopy.filterOpen },
	{ value: 'closing-soon', label: marketsCopy.filterClosingSoon },
	{ value: 'resolved', label: marketsCopy.filterResolved },
]

const SORT_OPTIONS: readonly { value: MarketSort; label: string }[] = [
	{ value: 'closing-soon', label: marketsCopy.sortClosingSoon },
	{ value: 'liquidity', label: marketsCopy.sortLiquidity },
	{ value: 'recent', label: favoritesCopy.recentlySaved },
]

function listPresentation(listKind: TradingListKind) {
	if (listKind === 'security-pools') return { title: liveCopy.securityPoolList, description: liveCopy.securityPoolListDescription, empty: liveCopy.noEligiblePools, emptyDetail: liveCopy.noEligiblePoolsDetail }
	return { title: liveCopy.marketList, description: undefined, empty: liveCopy.noMarkets, emptyDetail: undefined }
}

/** A pasted security pool address opens that pool in the lookup route's workflow, whether or not it is among the downloaded markets. */
function searchedPoolAddress(query: string) {
	const parsed = tryParseAddressInput(query.trim())
	return parsed === undefined || parsed === zeroAddress ? undefined : parsed
}

/** Search (which also opens a pasted pool address) and sort share the first row; the status filter leads the second. */
function MarketSearchRow({ options, arrangeable, registryOrder, lookupRoute, onChange }: { options: MarketListOptions; arrangeable: boolean; registryOrder: boolean; lookupRoute: TradingLookupRoute; onChange(next: MarketListOptions): void }) {
	const address = searchedPoolAddress(options.query)
	return (
		<div className='market-list-controls' role='group' aria-label={marketsCopy.listControls}>
			<form
				className='field market-list-search'
				role='search'
				onSubmit={event => {
					event.preventDefault()
					if (address === undefined) return
					window.location.hash = getTradingRouteHref(`#/${lookupRoute}/${address}`)
				}}
			>
				<FormInput type='search' aria-label={marketsCopy.searchLabel} placeholder={marketsCopy.searchPlaceholder} value={options.query} onInput={event => onChange({ ...options, query: event.currentTarget.value })} />
				{address === undefined ? undefined : (
					<button className='primary' type='submit'>
						{liveCopy.openPool}
					</button>
				)}
			</form>
			{arrangeable ? (
				<div className='market-list-sort'>
					<span className='metric-label' aria-hidden='true'>
						{marketsCopy.sortLabel}
					</span>
					<EnumDropdown
						ariaLabel={marketsCopy.sortLabel}
						value={registryOrder ? 'registry' : options.sort}
						options={registryOrder ? [{ value: 'registry', label: marketsCopy.sortRegistry }, ...SORT_OPTIONS] : SORT_OPTIONS}
						onChange={sort => {
							if (sort !== 'registry') onChange({ ...options, sort })
						}}
					/>
				</div>
			) : undefined}
		</div>
	)
}

function MarketCardList({ markets, listKind, lookupRoute, nowSeconds }: { markets: readonly LiveMarket[]; listKind: TradingListKind; lookupRoute: TradingLookupRoute; nowSeconds: bigint }) {
	return (
		<div className='entity-card-list market-list'>
			{markets.map(market => (
				<MarketCard key={market.pool} listKind={listKind} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} />
			))}
		</div>
	)
}

/**
 * List-first landing for a workflow: the address lookup sits above the candidate list, and the lookup route decides
 * where an opened address goes. The market list browses every market downloaded to this browser, favorites first,
 * and Discover reads the next registry page into that cache; security-pool candidates page through the registry.
 */
export function LiveMarketBrowser({
	lookupRoute,
	markets,
	discoveryRows,
	favorites = [],
	pageMarketCount,
	discoveryState,
	discoveryError,
	freshness,
	marketPage,
	workflowLocked,
	nowSeconds,
	retry,
	loadMarketPage,
}: {
	lookupRoute: TradingLookupRoute
	/** The market list passes every downloaded market; the security-pool list passes the loaded page. */
	markets: readonly LiveMarket[]
	discoveryRows?: readonly (LiveMarket | undefined)[] | undefined
	favorites?: readonly FavoriteEntry[]
	pageMarketCount: number
	discoveryState: 'loading' | 'ready' | 'error' | 'not-found'
	discoveryError: string | undefined
	freshness: DataFreshness
	marketPage: Readonly<{ start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }>
	workflowLocked: boolean
	nowSeconds: bigint
	retry(): void
	loadMarketPage(start: bigint | undefined): void
}) {
	const [listOptions, setListOptions] = useState(DEFAULT_LIST_OPTIONS)
	const hadRetainedMarkets = useRef(false)
	if (discoveryRows === undefined) hadRetainedMarkets.current = markets.length > 0
	// Saved rows remain visible during reloads; positional placeholders belong to an empty first load.
	const rows = hadRetainedMarkets.current ? undefined : discoveryRows
	const listKind = tradingListKindFor(lookupRoute) ?? 'markets'
	const presentation = listPresentation(listKind)
	const browsesDownloads = listKind === 'markets'
	// Filters, search, and sort run over every downloaded market; security-pool candidates are all open by construction.
	const arrangeable = browsesDownloads && (markets.length > 0 || rows !== undefined)
	const positional = rows !== undefined && listOptions === DEFAULT_LIST_OPTIONS
	const shownMarkets = arrangeable && !positional ? arrangeMarkets(markets, listOptions, nowSeconds) : markets
	const groups = browsesDownloads ? partitionFavoriteMarkets(shownMarkets, favorites) : { favorites: [], others: shownMarkets }
	const initialLoad = rows === undefined && discoveryState === 'loading' && pageMarketCount === 0 && (!browsesDownloads || markets.length === 0)
	const retryAction = <RetryAction label={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} />
	const cardList = (listed: readonly LiveMarket[]) => <MarketCardList markets={listed} listKind={listKind} lookupRoute={lookupRoute} nowSeconds={nowSeconds} />
	let list: ComponentChildren
	// An empty discovery page has no positions to hold, so it falls through to the empty state.
	if (rows !== undefined && rows.length > 0 && listOptions === DEFAULT_LIST_OPTIONS)
		list = (
			<div className='entity-card-list market-list'>
				{rows.map((market, index) => (
					<div className='market-discovery-slot' data-discovery-slot={index} key={index}>
						{market === undefined ? <SkeletonList label={liveCopy.discoveringSecurityPoolsFromFactory} rows={1} /> : <MarketCard listKind={listKind} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} />}
					</div>
				))}
			</div>
		)
	else if (markets.length === 0) list = <EmptyState title={presentation.empty} detail={presentation.emptyDetail} />
	else if (shownMarkets.length === 0)
		list = (
			<EmptyState
				title={marketsCopy.noMatches}
				actions={
					<button type='button' onClick={() => setListOptions(DEFAULT_LIST_OPTIONS)}>
						{marketsCopy.clearFilters}
					</button>
				}
			/>
		)
	else if (groups.favorites.length === 0) list = cardList(groups.others)
	else
		list = (
			<>
				<h3 className='eyebrow market-list-heading'>{liveCopy.favoriteMarkets}</h3>
				{cardList(groups.favorites)}
				{groups.others.length === 0 ? undefined : (
					<>
						<h3 className='eyebrow market-list-heading'>{liveCopy.otherMarkets}</h3>
						{cardList(groups.others)}
					</>
				)}
			</>
		)
	const hasScanned = freshness.updatedAt !== undefined
	const discovery = {
		// The last page restarts the scan from the first page.
		discoverNext: () => loadMarketPage(marketPage.nextStart ?? 0n),
		hasMore: !hasScanned || marketPage.nextStart !== undefined,
		hasScanned,
		loading: discoveryState === 'loading',
		scannedItemCount: marketPage.start + BigInt(pageMarketCount),
		totalCount: hasScanned ? marketPage.total : undefined,
	}
	const browseBar = browsesDownloads ? (
		<div className='local-browse-bar market-browse-bar'>
			{arrangeable ? (
				<p className='market-list-count' role='status'>
					{marketsCopy.resultCount(shownMarkets.length, markets.length)}
				</p>
			) : undefined}
			<UpdatedAgo {...freshness} />
			<DiscoveryControl discovery={discovery} discoverLabel={marketsCopy.discoverMarkets} disabled={workflowLocked} nounPlural={marketsCopy.marketsNoun} />
		</div>
	) : undefined
	let content
	if (initialLoad) content = <SkeletonList label={liveCopy.discoveringSecurityPoolsFromFactory} />
	else if (discoveryState === 'error' && markets.length === 0) content = <EmptyState title={liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)} actions={retryAction} />
	else
		content = (
			<>
				{discoveryState === 'error' ? <RetryableNotice message={liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery)} retryLabel={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} /> : undefined}
				{browsesDownloads ? (
					<div className='market-list-subbar'>
						{arrangeable ? (
							<ViewTabs ariaLabel={marketsCopy.filterLabel} className='market-list-filters' semantics='switcher' size='compact' variant='segmented' value={listOptions.filter} onChange={filter => setListOptions({ ...listOptions, filter })} options={FILTER_OPTIONS.map(option => ({ ...option }))} />
						) : undefined}
						{browseBar}
					</div>
				) : undefined}
				{list}
			</>
		)
	return (
		<SectionBlock className='market-browser' title={listKind === 'security-pools' ? presentation.title : undefined} description={presentation.description} variant='plain' busy={discoveryState === 'loading'} actions={browsesDownloads ? undefined : <UpdatedAgo {...freshness} />}>
			{browsesDownloads ? <MarketSearchRow options={listOptions} arrangeable={arrangeable} registryOrder={positional} lookupRoute={lookupRoute} onChange={setListOptions} /> : <OpenPoolForm disabled={false} target={lookupRoute} />}
			{content}
			{browsesDownloads ? undefined : (
				<PaginationControls
					hasNextPage={marketPage.nextStart !== undefined}
					hasPreviousPage={marketPage.previousStart !== undefined}
					loading={discoveryState === 'loading'}
					summary={pageMarketCount === 0 ? undefined : liveCopy.poolPageRange(marketPage.start + 1n, marketPage.start + BigInt(pageMarketCount), marketPage.total)}
					onPreviousPage={() => loadMarketPage(marketPage.previousStart)}
					onNextPage={() => loadMarketPage(marketPage.nextStart)}
				/>
			)}
		</SectionBlock>
	)
}
