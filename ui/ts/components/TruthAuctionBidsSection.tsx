import type { ComponentChildren } from 'preact'
import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { PaginationControls } from './PaginationControls.js'
import { SectionBlock } from './SectionBlock.js'
import type { TruthAuctionBidRowViewModel, ViewerTruthAuctionBidRowViewModel } from '../lib/truthAuctionBidViewModels.js'

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
			<span className='truth-auction-bid-row-label'>Price (ETH / REP)</span>
			<span>Bidder</span>
			<span>Bid Amount (ETH)</span>
			<span>Loaded Depth (ETH)</span>
			<span className='truth-auction-bid-row-status'>Status</span>
		</div>
	)
}

function ViewerBidsHeader({ showActions }: { showActions: boolean }) {
	return (
		<div className={`truth-auction-bid-row is-wallet ${showActions ? '' : 'is-no-actions'} is-header`}>
			{showActions ? <span>Selected</span> : undefined}
			<span className='truth-auction-bid-row-label'>Price (ETH / REP)</span>
			<span>Bid Amount (ETH)</span>
			<span className='truth-auction-bid-row-status'>Status</span>
		</div>
	)
}

export function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, renderPriceValue, rows }: TruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title='Truth Auction Bids'>
			<div className='truth-auction-bid-coverage-summary'>
				<MetricField label='Loaded Levels'>{loadedTickCount.toString()}</MetricField>
				<MetricField label='Loaded Bids'>{rows.length.toString()}</MetricField>
				<MetricField label='Coverage'>{`Showing ${rows.length.toString()} of ${aggregatedAuctionBidCountForLoadedTicks.toString()} bids across loaded levels`}</MetricField>
			</div>
			{loadingAggregatedAuctionBids ? <p className='detail'>Loading auction bids…</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount === 0 ? <p className='detail'>No active prices are currently visible for this auction.</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount > 0 && rows.length === 0 ? <p className='detail'>No bids are currently indexed for the loaded prices.</p> : undefined}
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
								<CurrencyValue value={row.ethAmount} suffix='ETH' />
							</span>
							<span>
								<CurrencyValue value={row.cumulativeEth} suffix='ETH' />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{hasMoreAggregatedAuctionBids ? <PaginationControls hasNextPage={hasMoreAggregatedAuctionBids} onLoadMore={onLoadNextAuctionBidPage} loadMoreLabel='Load More Truth Auction Bids' /> : undefined}
		</SectionBlock>
	)
}

export function ViewerTruthAuctionBidsSection({ accountAddress, hasMoreViewerBids, loadingTruthAuctionBook, onLoadNextViewerBidPage, onSettlementBidSelectionChange, renderPriceValue, rows, showSettlementActionColumn }: ViewerTruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title='My Bids'>
			{accountAddress === undefined ? <p className='detail'>Connect a wallet to inspect your submitted truth auction bids.</p> : undefined}
			{accountAddress !== undefined && loadingTruthAuctionBook ? <p className='detail'>Loading your bids…</p> : undefined}
			{accountAddress !== undefined && !loadingTruthAuctionBook && rows.length === 0 ? <p className='detail'>No bids from this wallet are indexed for the current auction.</p> : undefined}
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
								<CurrencyValue value={row.ethAmount} suffix='ETH' />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{accountAddress !== undefined && hasMoreViewerBids ? <PaginationControls hasNextPage={hasMoreViewerBids} onLoadMore={onLoadNextViewerBidPage} loadMoreLabel='Load More Of My Bids' /> : undefined}
		</SectionBlock>
	)
}
