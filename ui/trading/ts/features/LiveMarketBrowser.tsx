import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { liveCopy } from '../copy/live.js'
import { marketsCopy } from '../copy/markets.js'
import { arrangeMarkets, type MarketFilter, type MarketListOptions, type MarketSort } from '../lib/marketListing.js'
import { getTradingRouteHref, tradingListKindFor, type TradingListKind, type TradingLookupRoute } from '../lib/routing.js'
import type { LiveMarket } from '../protocol/live.js'
import { MarketCard } from './MarketCard.js'

const DEFAULT_LIST_OPTIONS: MarketListOptions = { filter: 'all', query: '', sort: 'recent' }

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
	if (listKind === 'security-pools') return { empty: liveCopy.noEligiblePools, emptyDetail: liveCopy.noEligiblePoolsDetail }
	return { empty: liveCopy.noMarkets, emptyDetail: liveCopy.noMarketsDetail }
}

/** A pasted security pool address opens that pool in the lookup route's workflow, whether or not it is among the downloaded markets. */
function searchedPoolAddress(query: string) {
	const parsed = tryParseAddressInput(query.trim())
	return parsed === undefined || parsed === zeroAddress ? undefined : parsed
}

/** Search (which also opens a pasted pool address) and sort share the first row; the status filter leads the second. */
function MarketSearchRow({ options, arrangeable, lookupRoute, onChange }: { options: MarketListOptions; arrangeable: boolean; lookupRoute: TradingLookupRoute; onChange(next: MarketListOptions): void }) {
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
				<FormInput type='search' aria-label={lookupRoute === 'create-market' ? marketsCopy.searchPoolsLabel : marketsCopy.searchLabel} placeholder={marketsCopy.searchPlaceholder} value={options.query} onInput={event => onChange({ ...options, query: event.currentTarget.value })} />
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

/** Browser-local favorites with search and direct address lookup, matching Statoblast's pool directory. */
export function LiveMarketBrowser({
	lookupRoute,
	markets,
	fetchedAtByPool,
	discoveryState,
	discoveryError,
	workflowLocked,
	nowSeconds,
	retry,
}: {
	lookupRoute: TradingLookupRoute
	fetchedAtByPool?: ReadonlyMap<string, number> | undefined
	markets: readonly LiveMarket[]
	discoveryState: 'loading' | 'ready' | 'error' | 'not-found'
	discoveryError: string | undefined
	workflowLocked: boolean
	nowSeconds: bigint
	retry(): void
}) {
	const [listOptions, setListOptions] = useState(DEFAULT_LIST_OPTIONS)
	const listKind = tradingListKindFor(lookupRoute) ?? 'markets'
	const presentation = listPresentation(listKind)
	const shownMarkets = arrangeMarkets(markets, listOptions, nowSeconds)
	let list: ComponentChildren
	if (markets.length === 0) list = <EmptyState title={presentation.empty} detail={presentation.emptyDetail} />
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
	else list = <MarketCardList markets={shownMarkets} listKind={listKind} lookupRoute={lookupRoute} nowSeconds={nowSeconds} fetchedAtByPool={fetchedAtByPool} />
	return (
		<SectionBlock className='market-browser' variant='plain'>
			<p className='detail'>{favoritesCopy.formatCollectionTab(favoritesCopy.favorites, markets.length)}</p>
			<MarketSearchRow options={listOptions} arrangeable={markets.length > 0} lookupRoute={lookupRoute} onChange={setListOptions} />
			{discoveryState === 'error' ? <RetryableNotice message={liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)} retryLabel={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} /> : undefined}
			{markets.length > 0 ? (
				<div className='market-list-subbar'>
					<ViewTabs ariaLabel={marketsCopy.filterLabel} className='market-list-filters' semantics='switcher' size='compact' variant='segmented' value={listOptions.filter} onChange={filter => setListOptions({ ...listOptions, filter })} options={FILTER_OPTIONS.map(option => ({ ...option }))} />
					{shownMarkets.length === markets.length ? undefined : (
						<p className='market-list-count' role='status'>
							{listKind === 'security-pools' ? marketsCopy.poolResultCount(shownMarkets.length, markets.length) : marketsCopy.resultCount(shownMarkets.length, markets.length)}
						</p>
					)}
				</div>
			) : undefined}
			{list}
		</SectionBlock>
	)
}
