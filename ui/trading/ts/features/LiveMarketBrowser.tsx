import { useState } from 'preact/hooks'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { RetryAction, RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { liveCopy } from '../copy/live.js'
import { marketsCopy } from '../copy/markets.js'
import { arrangeMarkets, type MarketFilter, type MarketListOptions, type MarketSort } from '../lib/marketListing.js'
import { tradingListKindFor, type TradingListKind, type TradingLookupRoute } from '../lib/routing.js'
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
	{ value: 'newest', label: marketsCopy.sortNewest },
]

function listPresentation(listKind: TradingListKind) {
	if (listKind === 'security-pools') return { title: liveCopy.securityPoolList, description: liveCopy.securityPoolListDescription, empty: liveCopy.noEligiblePools }
	return { title: liveCopy.marketList, description: undefined, empty: liveCopy.noMarketsOnPage }
}

function MarketListControls({ options, onChange }: { options: MarketListOptions; onChange(next: MarketListOptions): void }) {
	return (
		<div className='market-list-controls' role='group' aria-label={marketsCopy.listControls}>
			<div className='field market-list-search'>
				<FormInput type='search' aria-label={marketsCopy.searchLabel} placeholder={marketsCopy.searchPlaceholder} value={options.query} onInput={event => onChange({ ...options, query: event.currentTarget.value })} />
			</div>
			<ViewTabs ariaLabel={marketsCopy.filterLabel} className='market-list-filters' semantics='switcher' size='compact' variant='segmented' value={options.filter} onChange={filter => onChange({ ...options, filter })} options={FILTER_OPTIONS.map(option => ({ ...option }))} />
			<div className='market-list-sort'>
				<span className='metric-label' aria-hidden='true'>
					{marketsCopy.sortLabel}
				</span>
				<EnumDropdown ariaLabel={marketsCopy.sortLabel} value={options.sort} options={SORT_OPTIONS} onChange={sort => onChange({ ...options, sort })} />
			</div>
		</div>
	)
}

/** List-first landing for a workflow: the address lookup sits above the pageable candidate list, and the lookup route decides where an opened address goes. */
export function LiveMarketBrowser({
	lookupRoute,
	markets,
	pageMarketCount,
	discoveryState,
	discoveryError,
	marketPage,
	workflowLocked,
	nowSeconds,
	retry,
	loadMarketPage,
}: {
	lookupRoute: TradingLookupRoute
	markets: readonly LiveMarket[]
	pageMarketCount: number
	discoveryState: 'loading' | 'ready' | 'error'
	discoveryError: string | undefined
	marketPage: Readonly<{ start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }>
	workflowLocked: boolean
	nowSeconds: bigint
	retry(): void
	loadMarketPage(start: bigint | undefined): void
}) {
	const [listOptions, setListOptions] = useState(DEFAULT_LIST_OPTIONS)
	const listKind = tradingListKindFor(lookupRoute) ?? 'markets'
	const presentation = listPresentation(listKind)
	// Filters, search, and sort narrow the loaded page only; security-pool candidates are all open by construction.
	const arrangeable = listKind === 'markets' && markets.length > 0
	const shownMarkets = arrangeable ? arrangeMarkets(markets, listOptions, nowSeconds) : markets
	const initialLoad = discoveryState === 'loading' && pageMarketCount === 0
	const retryAction = <RetryAction label={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} />
	let list
	if (markets.length === 0) list = <EmptyState title={presentation.empty} />
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
	else
		list = (
			<div className='entity-card-list market-list'>
				{shownMarkets.map(market => (
					<MarketCard key={market.pool} listKind={listKind} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} />
				))}
			</div>
		)
	let content
	if (initialLoad) content = <EmptyState live title={liveCopy.discoveringSecurityPoolsFromFactory} />
	else if (discoveryState === 'error' && pageMarketCount === 0) content = <EmptyState title={liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)} actions={retryAction} />
	else
		content = (
			<>
				{discoveryState === 'error' ? <RetryableNotice message={liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery)} retryLabel={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} /> : undefined}
				{arrangeable ? (
					<>
						<MarketListControls options={listOptions} onChange={setListOptions} />
						<p className='market-list-count' role='status'>
							{marketsCopy.resultCount(shownMarkets.length, markets.length)}
						</p>
					</>
				) : undefined}
				{list}
			</>
		)
	return (
		<SectionBlock className='market-browser' title={listKind === 'security-pools' ? presentation.title : undefined} description={presentation.description} variant='plain' busy={discoveryState === 'loading'}>
			<OpenPoolForm disabled={workflowLocked} target={lookupRoute} />
			{content}
			<PaginationControls
				hasNextPage={marketPage.nextStart !== undefined}
				hasPreviousPage={marketPage.previousStart !== undefined}
				loading={discoveryState === 'loading' || workflowLocked}
				summary={pageMarketCount === 0 ? undefined : liveCopy.poolPageRange(marketPage.start + 1n, marketPage.start + BigInt(pageMarketCount), marketPage.total)}
				onPreviousPage={() => loadMarketPage(marketPage.previousStart)}
				onNextPage={() => loadMarketPage(marketPage.nextStart)}
			/>
		</SectionBlock>
	)
}
