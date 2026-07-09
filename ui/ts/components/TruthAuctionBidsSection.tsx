import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { PaginationControls } from './PaginationControls.js'
import { SectionBlock } from './SectionBlock.js'
import type { TruthAuctionBidRowViewModel, ViewerTruthAuctionBidRowViewModel } from '../lib/truthAuctionBidViewModels.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
			<span className='truth-auction-bid-row-label'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy001}</span>
			<span>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy002}</span>
			<span>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy003}</span>
			<span>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy004}</span>
			<span className='truth-auction-bid-row-status'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy005}</span>
		</div>
	)
}

function ViewerBidsHeader({ showActions }: { showActions: boolean }) {
	return (
		<div className={`truth-auction-bid-row is-wallet ${showActions ? '' : 'is-no-actions'} is-header`}>
			{showActions ? <span>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy006}</span> : undefined}
			<span className='truth-auction-bid-row-label'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy007}</span>
			<span>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy008}</span>
			<span className='truth-auction-bid-row-status'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy009}</span>
		</div>
	)
}

export function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, renderPriceValue, rows }: TruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={TSX_STRINGS.componentsTruthAuctionBidsSection.copy010}>
			<div className='truth-auction-bid-coverage-summary'>
				<MetricField label={TSX_STRINGS.componentsTruthAuctionBidsSection.copy011}>{loadedTickCount.toString()}</MetricField>
				<MetricField label={TSX_STRINGS.componentsTruthAuctionBidsSection.copy012}>{rows.length.toString()}</MetricField>
				<MetricField label={TSX_STRINGS.componentsTruthAuctionBidsSection.copy013}>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy014(rows.length.toString(), aggregatedAuctionBidCountForLoadedTicks.toString())}</MetricField>
			</div>
			{loadingAggregatedAuctionBids ? <p className='detail'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy015}</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount === 0 ? <p className='detail'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy016}</p> : undefined}
			{!loadingAggregatedAuctionBids && loadedTickCount > 0 && rows.length === 0 ? <p className='detail'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy017}</p> : undefined}
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
								<CurrencyValue value={row.ethAmount} suffix={TSX_STRINGS.componentsTruthAuctionBidsSection.copy018} />
							</span>
							<span>
								<CurrencyValue value={row.cumulativeEth} suffix={TSX_STRINGS.componentsTruthAuctionBidsSection.copy019} />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{hasMoreAggregatedAuctionBids ? <PaginationControls hasNextPage={hasMoreAggregatedAuctionBids} onLoadMore={onLoadNextAuctionBidPage} loadMoreLabel={TSX_STRINGS.componentsTruthAuctionBidsSection.copy020} /> : undefined}
		</SectionBlock>
	)
}

export function ViewerTruthAuctionBidsSection({ accountAddress, hasMoreViewerBids, loadingTruthAuctionBook, onLoadNextViewerBidPage, onSettlementBidSelectionChange, renderPriceValue, rows, showSettlementActionColumn }: ViewerTruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={TSX_STRINGS.componentsTruthAuctionBidsSection.copy021}>
			{accountAddress === undefined ? <p className='detail'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy022}</p> : undefined}
			{accountAddress !== undefined && loadingTruthAuctionBook ? <p className='detail'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy023}</p> : undefined}
			{accountAddress !== undefined && !loadingTruthAuctionBook && rows.length === 0 ? <p className='detail'>{TSX_STRINGS.componentsTruthAuctionBidsSection.copy024}</p> : undefined}
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
								<CurrencyValue value={row.ethAmount} suffix={TSX_STRINGS.componentsTruthAuctionBidsSection.copy025} />
							</span>
							<span className='truth-auction-bid-row-status'>
								<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
							</span>
						</div>
					))}
				</div>
			)}
			{accountAddress !== undefined && hasMoreViewerBids ? <PaginationControls hasNextPage={hasMoreViewerBids} onLoadMore={onLoadNextViewerBidPage} loadMoreLabel={TSX_STRINGS.componentsTruthAuctionBidsSection.copy026} /> : undefined}
		</SectionBlock>
	)
}
