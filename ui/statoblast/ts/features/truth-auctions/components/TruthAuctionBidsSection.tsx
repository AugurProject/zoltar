import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '@zoltar/ui-zoltar/copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import type { TruthAuctionBidRowViewModel, ViewerTruthAuctionBidRowViewModel } from '../lib/truthAuctionBidViewModels.js'

type TruthAuctionBidsSectionProps = {
	aggregatedAuctionBidCountForLoadedTicks: bigint
	error?: string | undefined
	hasLoadedData?: boolean
	hasMoreAggregatedAuctionBids: boolean
	loadedTickCount: number
	loadingAggregatedAuctionBids: boolean
	onLoadNextAuctionBidPage: () => void
	onRetry?: (() => void) | undefined
	renderPriceValue: (value: bigint | undefined) => ComponentChildren
	retrying?: boolean
	rows: TruthAuctionBidRowViewModel[]
}

type ViewerTruthAuctionBidsSectionProps = {
	accountAddress: Address | undefined
	error?: string | undefined
	hasLoadedData?: boolean
	hasMoreViewerBids: boolean
	loadingTruthAuctionBook: boolean
	onLoadNextViewerBidPage: () => void
	onRetry?: (() => void) | undefined
	onSettlementBidSelectionChange: (bidKey: string, checked: boolean) => void
	renderPriceValue: (value: bigint | undefined) => ComponentChildren
	retrying?: boolean
	rows: ViewerTruthAuctionBidRowViewModel[]
	showSettlementActionColumn: boolean
}

function AuctionBidsHeader() {
	return (
		<div className='truth-auction-bid-row is-wide is-no-actions is-header' role='row'>
			<span className='truth-auction-bid-row-label' role='columnheader'>
				{forkAuctionCopy.priceEthPerRep}
			</span>
			<span role='columnheader'>{forkAuctionCopy.bidder}</span>
			<span role='columnheader'>{forkAuctionCopy.bidAmountEth}</span>
			<span role='columnheader'>{forkAuctionCopy.loadedDepthEth}</span>
			<span className='truth-auction-bid-row-status' role='columnheader'>
				{commonCopy.status}
			</span>
		</div>
	)
}

function ViewerBidsHeader({ showActions }: { showActions: boolean }) {
	return (
		<div className={`truth-auction-bid-row is-wallet ${showActions ? '' : 'is-no-actions'} is-header`} role='row'>
			{showActions ? <span role='columnheader'>{commonCopy.selected}</span> : undefined}
			<span className='truth-auction-bid-row-label' role='columnheader'>
				{forkAuctionCopy.priceEthPerRep}
			</span>
			<span role='columnheader'>{forkAuctionCopy.bidAmountEth}</span>
			<span className='truth-auction-bid-row-status' role='columnheader'>
				{commonCopy.status}
			</span>
		</div>
	)
}

export function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, error, hasLoadedData = true, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, onRetry, renderPriceValue, retrying = false, rows }: TruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={forkAuctionCopy.currentBids} variant='embedded'>
			{hasLoadedData ? (
				<div className='truth-auction-bid-coverage-summary'>
					<MetricField label={forkAuctionCopy.loadedLevels}>{loadedTickCount.toString()}</MetricField>
					<MetricField label={forkAuctionCopy.loadedBids}>{rows.length.toString()}</MetricField>
					<MetricField label={forkAuctionCopy.coverage}>{forkAuctionCopy.formatLoadedBidCoverageSummary(rows.length.toString(), aggregatedAuctionBidCountForLoadedTicks.toString())}</MetricField>
				</div>
			) : undefined}
			{loadingAggregatedAuctionBids ? (
				<p className='detail'>
					<LoadingText>{forkAuctionCopy.loadingAuctionBids}</LoadingText>
				</p>
			) : undefined}
			<ErrorNotice message={error} />
			{error === undefined || onRetry === undefined ? undefined : (
				<div className='actions'>
					<button aria-label={forkAuctionCopy.retryCurrentBids} className='secondary' disabled={retrying} onClick={onRetry} type='button'>
						{retrying ? <LoadingText>{forkAuctionCopy.retryingAuctionBids}</LoadingText> : forkAuctionCopy.retryAuctionBids}
					</button>
				</div>
			)}
			{hasLoadedData && error === undefined && !loadingAggregatedAuctionBids && loadedTickCount === 0 ? <p className='detail'>{forkAuctionCopy.auctionPriceLevelsEmpty}</p> : undefined}
			{hasLoadedData && error === undefined && !loadingAggregatedAuctionBids && loadedTickCount > 0 && rows.length === 0 ? <p className='detail'>{forkAuctionCopy.loadedPriceBidsEmpty}</p> : undefined}
			{rows.length === 0 ? undefined : (
				<div className='truth-auction-bid-table-scroll' role='region' aria-label={forkAuctionCopy.scrollableAuctionBidHistory} tabIndex={0}>
					<div className='truth-auction-bid-table' role='table' aria-label={forkAuctionCopy.auctionBidHistory}>
						<AuctionBidsHeader />
						{rows.map(row => (
							<div className='truth-auction-bid-row is-wide is-no-actions' key={row.key} role='row'>
								<span className='truth-auction-bid-row-label' data-label={forkAuctionCopy.priceEthPerRep} role='cell'>
									{renderPriceValue(row.price)}
								</span>
								<div className='truth-auction-bid-row-address' data-label={forkAuctionCopy.bidder} role='cell'>
									<AddressValue address={row.bidder} copyable={false} />
								</div>
								<span data-label={forkAuctionCopy.bidAmountEth} role='cell'>
									<CurrencyValue value={row.bidAmountAttoEth} suffix={commonCopy.eth} copyable={false} />
								</span>
								<span data-label={forkAuctionCopy.loadedDepthEth} role='cell'>
									<CurrencyValue value={row.cumulativeBidAttoEth} suffix={commonCopy.eth} copyable={false} />
								</span>
								<span className='truth-auction-bid-row-status' data-label={commonCopy.status} role='cell'>
									<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
								</span>
							</div>
						))}
					</div>
				</div>
			)}
			{error === undefined && hasMoreAggregatedAuctionBids ? <PaginationControls hasNextPage={hasMoreAggregatedAuctionBids} loading={loadingAggregatedAuctionBids} onLoadMore={onLoadNextAuctionBidPage} loadMoreLabel={forkAuctionCopy.loadMoreTruthAuctionBids} /> : undefined}
		</SectionBlock>
	)
}

export function ViewerTruthAuctionBidsSection({ accountAddress, error, hasLoadedData = true, hasMoreViewerBids, loadingTruthAuctionBook, onLoadNextViewerBidPage, onRetry, onSettlementBidSelectionChange, renderPriceValue, retrying = false, rows, showSettlementActionColumn }: ViewerTruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={forkAuctionCopy.myBids} variant='embedded'>
			{accountAddress === undefined ? <p className='detail'>{forkAuctionCopy.walletBidsConnectionRequired}</p> : undefined}
			{accountAddress !== undefined && loadingTruthAuctionBook ? (
				<p className='detail'>
					<LoadingText>{forkAuctionCopy.loadingYourBids}</LoadingText>
				</p>
			) : undefined}
			<ErrorNotice message={error} />
			{error === undefined || onRetry === undefined ? undefined : (
				<div className='actions'>
					<button aria-label={forkAuctionCopy.retryMyBids} className='secondary' disabled={retrying} onClick={onRetry} type='button'>
						{retrying ? <LoadingText>{forkAuctionCopy.retryingAuctionBids}</LoadingText> : forkAuctionCopy.retryAuctionBids}
					</button>
				</div>
			)}
			{accountAddress !== undefined && hasLoadedData && error === undefined && !loadingTruthAuctionBook && rows.length === 0 ? <p className='detail'>{forkAuctionCopy.walletBidsEmpty}</p> : undefined}
			{rows.length === 0 ? undefined : (
				<div className='truth-auction-bid-table-scroll is-wallet' role='region' aria-label={forkAuctionCopy.scrollableMyBids} tabIndex={0}>
					<div className='truth-auction-bid-table' role='table' aria-label={forkAuctionCopy.myBids}>
						<ViewerBidsHeader showActions={showSettlementActionColumn} />
						{rows.map(row => (
							<div className={`truth-auction-bid-row is-wallet ${showSettlementActionColumn ? '' : 'is-no-actions'}`} key={row.key} role='row'>
								{showSettlementActionColumn ? (
									<div className='truth-auction-bid-row-actions' data-label={commonCopy.selected} role='cell'>
										{(() => {
											const settlementControl = row.settlementControl
											if (settlementControl === undefined) return undefined
											return <input disabled={settlementControl.disabled} type='checkbox' checked={settlementControl.checked} title={settlementControl.title} aria-label={settlementControl.ariaLabel} onChange={event => onSettlementBidSelectionChange(settlementControl.bidKey, event.currentTarget.checked)} />
										})()}
									</div>
								) : undefined}
								<span className='truth-auction-bid-row-label' data-label={forkAuctionCopy.priceEthPerRep} role='cell'>
									{renderPriceValue(row.price)}
								</span>
								<span data-label={forkAuctionCopy.bidAmountEth} role='cell'>
									<CurrencyValue value={row.bidAmountAttoEth} suffix={commonCopy.eth} copyable={false} />
								</span>
								<span className='truth-auction-bid-row-status' data-label={commonCopy.status} role='cell'>
									<span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span>
								</span>
							</div>
						))}
					</div>
				</div>
			)}
			{accountAddress !== undefined && error === undefined && hasMoreViewerBids ? <PaginationControls hasNextPage={hasMoreViewerBids} loading={loadingTruthAuctionBook} onLoadMore={onLoadNextViewerBidPage} loadMoreLabel={forkAuctionCopy.loadMoreOfMyBids} /> : undefined}
		</SectionBlock>
	)
}
