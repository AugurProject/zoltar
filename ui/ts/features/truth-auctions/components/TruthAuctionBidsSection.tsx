import * as commonCopy from '../../../copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from '../../../components/AddressValue.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { MetricField } from '../../../components/MetricField.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
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
			<span className='truth-auction-bid-row-label'>{forkAuctionCopy.priceEthPerRep}</span>
			<span>{forkAuctionCopy.bidder}</span>
			<span>{forkAuctionCopy.bidAmountEth}</span>
			<span>{forkAuctionCopy.loadedDepthEth}</span>
			<span className='truth-auction-bid-row-status'>{commonCopy.status}</span>
		</div>
	)
}

function ViewerBidsHeader({ showActions }: { showActions: boolean }) {
	return (
		<div className={`truth-auction-bid-row is-wallet ${showActions ? '' : 'is-no-actions'} is-header`}>
			{showActions ? <span>{commonCopy.selected}</span> : undefined}
			<span className='truth-auction-bid-row-label'>{forkAuctionCopy.priceEthPerRep}</span>
			<span>{forkAuctionCopy.bidAmountEth}</span>
			<span className='truth-auction-bid-row-status'>{commonCopy.status}</span>
		</div>
	)
}

export function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, renderPriceValue, rows }: TruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={forkAuctionCopy.truthAuctionBids}>
			<div className='truth-auction-bid-coverage-summary'>
				<MetricField label={forkAuctionCopy.loadedLevels}>{loadedTickCount.toString()}</MetricField>
				<MetricField label={forkAuctionCopy.loadedBids}>{rows.length.toString()}</MetricField>
				<MetricField label={forkAuctionCopy.coverage}>{forkAuctionCopy.formatLoadedBidCoverageSummary(rows.length.toString(), aggregatedAuctionBidCountForLoadedTicks.toString())}</MetricField>
			</div>
			{loadingAggregatedAuctionBids ? <p className='detail'>{forkAuctionCopy.loadingAuctionBids}</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount === 0 ? <p className='detail'>{forkAuctionCopy.auctionPriceLevelsEmpty}</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount > 0 && rows.length === 0 ? <p className='detail'>{forkAuctionCopy.loadedPriceBidsEmpty}</p> : undefined}
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
								<CurrencyValue value={row.ethAmount} suffix={commonCopy.eth} />
							</span>
							<span>
								<CurrencyValue value={row.cumulativeEth} suffix={commonCopy.eth} />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{hasMoreAggregatedAuctionBids ? <PaginationControls hasNextPage={hasMoreAggregatedAuctionBids} onLoadMore={onLoadNextAuctionBidPage} loadMoreLabel={forkAuctionCopy.loadMoreTruthAuctionBids} /> : undefined}
		</SectionBlock>
	)
}

export function ViewerTruthAuctionBidsSection({ accountAddress, hasMoreViewerBids, loadingTruthAuctionBook, onLoadNextViewerBidPage, onSettlementBidSelectionChange, renderPriceValue, rows, showSettlementActionColumn }: ViewerTruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={forkAuctionCopy.myBids}>
			{accountAddress === undefined ? <p className='detail'>{forkAuctionCopy.walletBidsConnectionRequired}</p> : undefined}
			{accountAddress !== undefined && loadingTruthAuctionBook ? <p className='detail'>{forkAuctionCopy.loadingYourBids}</p> : undefined}
			{accountAddress !== undefined && !loadingTruthAuctionBook && rows.length === 0 ? <p className='detail'>{forkAuctionCopy.walletBidsEmpty}</p> : undefined}
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
								<CurrencyValue value={row.ethAmount} suffix={commonCopy.eth} />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{accountAddress !== undefined && hasMoreViewerBids ? <PaginationControls hasNextPage={hasMoreViewerBids} onLoadMore={onLoadNextViewerBidPage} loadMoreLabel={forkAuctionCopy.loadMoreOfMyBids} /> : undefined}
		</SectionBlock>
	)
}
