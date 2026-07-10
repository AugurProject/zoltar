import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { PaginationControls } from './PaginationControls.js'
import { SectionBlock } from './SectionBlock.js'
import type { TruthAuctionBidRowViewModel, ViewerTruthAuctionBidRowViewModel } from '../lib/truthAuctionBidViewModels.js'
import {
	UI_STRING_BIDDER,
	UI_STRING_BID_AMOUNT_ETH,
	UI_STRING_CONNECT_A_WALLET_TO_INSPECT_YOUR_SUBMITTED_TRUTH_AUCTION_BIDS,
	UI_STRING_COVERAGE,
	UI_STRING_ETH,
	UI_STRING_LOADED_BIDS,
	UI_STRING_LOADED_DEPTH_ETH,
	UI_STRING_LOADED_LEVELS,
	UI_STRING_LOADING_AUCTION_BIDS,
	UI_STRING_LOADING_YOUR_BIDS,
	UI_STRING_LOAD_MORE_OF_MY_BIDS,
	UI_STRING_LOAD_MORE_TRUTH_AUCTION_BIDS,
	UI_STRING_MY_BIDS,
	UI_STRING_NO_ACTIVE_PRICES_ARE_CURRENTLY_VISIBLE_FOR_THIS_AUCTION,
	UI_STRING_NO_BIDS_ARE_CURRENTLY_INDEXED_FOR_THE_LOADED_PRICES,
	UI_STRING_NO_BIDS_FROM_THIS_WALLET_ARE_INDEXED_FOR_THE_CURRENT_AUCTION,
	UI_STRING_PRICE_ETH_PER_REP,
	UI_STRING_SELECTED,
	UI_STRING_STATUS,
	UI_STRING_TRUTH_AUCTION_BIDS,
	UI_TEMPLATE_LOADED_BID_COVERAGE_SUMMARY,
} from '../lib/uiStrings.js'

type TruthAuctionBidsSectionProps = {
	aggregatedAuctionBidCountForLoadedTicks: bigint
	hasMoreAggregatedAuctionBids: boolean
	loadedTickCount: number
	loadingAggregatedAuctionBids: boolean
	onLoadNextAuctionBidPage: () => void
	renderPriceValue: (value: bigint | undefined) => ComponentChildren
	rows: TruthAuctionBidRowViewModel[]
}

type ViewerTruthAuctionBidsSectionProps = {
	accountAddress: Address | undefined
	hasMoreViewerBids: boolean
	loadingTruthAuctionBook: boolean
	onLoadNextViewerBidPage: () => void
	onSettlementBidSelectionChange: (bidKey: string, checked: boolean) => void
	renderPriceValue: (value: bigint | undefined) => ComponentChildren
	rows: ViewerTruthAuctionBidRowViewModel[]
	showSettlementActionColumn: boolean
}

function AuctionBidsHeader() {
	return (
		<div className='truth-auction-bid-row is-wide is-no-actions is-header'>
			<span className='truth-auction-bid-row-label'>{UI_STRING_PRICE_ETH_PER_REP}</span>
			<span>{UI_STRING_BIDDER}</span>
			<span>{UI_STRING_BID_AMOUNT_ETH}</span>
			<span>{UI_STRING_LOADED_DEPTH_ETH}</span>
			<span className='truth-auction-bid-row-status'>{UI_STRING_STATUS}</span>
		</div>
	)
}

function ViewerBidsHeader({ showActions }: { showActions: boolean }) {
	return (
		<div className={`truth-auction-bid-row is-wallet ${showActions ? '' : 'is-no-actions'} is-header`}>
			{showActions ? <span>{UI_STRING_SELECTED}</span> : undefined}
			<span className='truth-auction-bid-row-label'>{UI_STRING_PRICE_ETH_PER_REP}</span>
			<span>{UI_STRING_BID_AMOUNT_ETH}</span>
			<span className='truth-auction-bid-row-status'>{UI_STRING_STATUS}</span>
		</div>
	)
}

export function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, renderPriceValue, rows }: TruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={UI_STRING_TRUTH_AUCTION_BIDS}>
			<div className='truth-auction-bid-coverage-summary'>
				<MetricField label={UI_STRING_LOADED_LEVELS}>{loadedTickCount.toString()}</MetricField>
				<MetricField label={UI_STRING_LOADED_BIDS}>{rows.length.toString()}</MetricField>
				<MetricField label={UI_STRING_COVERAGE}>{UI_TEMPLATE_LOADED_BID_COVERAGE_SUMMARY(rows.length.toString(), aggregatedAuctionBidCountForLoadedTicks.toString())}</MetricField>
			</div>
			{loadingAggregatedAuctionBids ? <p className='detail'>{UI_STRING_LOADING_AUCTION_BIDS}</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount === 0 ? <p className='detail'>{UI_STRING_NO_ACTIVE_PRICES_ARE_CURRENTLY_VISIBLE_FOR_THIS_AUCTION}</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount > 0 && rows.length === 0 ? <p className='detail'>{UI_STRING_NO_BIDS_ARE_CURRENTLY_INDEXED_FOR_THE_LOADED_PRICES}</p> : undefined}
			{rows.length === 0 ? undefined : (
				<div className='truth-auction-bid-table'>
					<AuctionBidsHeader />
					{rows.map(row => (
						<div className='truth-auction-bid-row is-wide is-no-actions' key={row.key}>
							<span className='truth-auction-bid-row-label'>{renderPriceValue(row.price)}</span>
							<div className='truth-auction-bid-row-address'>
								<AddressValue address={row.bidder} />
							</div>
							<span>
								<CurrencyValue value={row.ethAmount} suffix={UI_STRING_ETH} />
							</span>
							<span>
								<CurrencyValue value={row.cumulativeEth} suffix={UI_STRING_ETH} />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{hasMoreAggregatedAuctionBids ? <PaginationControls hasNextPage={hasMoreAggregatedAuctionBids} onLoadMore={onLoadNextAuctionBidPage} loadMoreLabel={UI_STRING_LOAD_MORE_TRUTH_AUCTION_BIDS} /> : undefined}
		</SectionBlock>
	)
}

export function ViewerTruthAuctionBidsSection({ accountAddress, hasMoreViewerBids, loadingTruthAuctionBook, onLoadNextViewerBidPage, onSettlementBidSelectionChange, renderPriceValue, rows, showSettlementActionColumn }: ViewerTruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={UI_STRING_MY_BIDS}>
			{accountAddress === undefined ? <p className='detail'>{UI_STRING_CONNECT_A_WALLET_TO_INSPECT_YOUR_SUBMITTED_TRUTH_AUCTION_BIDS}</p> : undefined}
			{accountAddress !== undefined && loadingTruthAuctionBook ? <p className='detail'>{UI_STRING_LOADING_YOUR_BIDS}</p> : undefined}
			{accountAddress !== undefined && !loadingTruthAuctionBook && rows.length === 0 ? <p className='detail'>{UI_STRING_NO_BIDS_FROM_THIS_WALLET_ARE_INDEXED_FOR_THE_CURRENT_AUCTION}</p> : undefined}
			{rows.length === 0 ? undefined : (
				<div className='truth-auction-bid-table'>
					<ViewerBidsHeader showActions={showSettlementActionColumn} />
					{rows.map(row => (
						<div className={`truth-auction-bid-row is-wallet ${showSettlementActionColumn ? '' : 'is-no-actions'}`} key={row.key}>
							{showSettlementActionColumn ? (
								<div className='truth-auction-bid-row-actions'>
									{(() => {
										const settlementControl = row.settlementControl
										if (settlementControl === undefined) return undefined
										return <input disabled={settlementControl.disabled} type='checkbox' checked={settlementControl.checked} title={settlementControl.title} aria-label={settlementControl.ariaLabel} onChange={event => onSettlementBidSelectionChange(settlementControl.bidKey, event.currentTarget.checked)} />
									})()}
								</div>
							) : undefined}
							<span className='truth-auction-bid-row-label'>{renderPriceValue(row.price)}</span>
							<span>
								<CurrencyValue value={row.ethAmount} suffix={UI_STRING_ETH} />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{accountAddress !== undefined && hasMoreViewerBids ? <PaginationControls hasNextPage={hasMoreViewerBids} onLoadMore={onLoadNextViewerBidPage} loadMoreLabel={UI_STRING_LOAD_MORE_OF_MY_BIDS} /> : undefined}
		</SectionBlock>
	)
}
