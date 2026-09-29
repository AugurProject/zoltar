import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
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
	onSettlementBidSelectionReplace: (bidKeys: string[]) => void
	renderPriceValue: (value: bigint | undefined) => ComponentChildren
	retrying?: boolean
	rows: ViewerTruthAuctionBidRowViewModel[]
	showSettlementActionColumn: boolean
}

type BidTableColumn<TRow> = {
	/** Applied to both the header and the body cells. */
	className?: string
	/** Applied to body cells only; such cells hold block content and render as a `div`. */
	blockCellClassName?: string
	label: string
	render: (row: TRow) => ComponentChildren
}

type BidTableRow = { key: string; statusLabel: string; statusToneClassName: string }

function priceColumn<TRow extends { price: bigint | undefined }>(renderPriceValue: (value: bigint | undefined) => ComponentChildren): BidTableColumn<TRow> {
	return { className: 'truth-auction-bid-row-label', label: forkAuctionCopy.priceEthPerRep, render: row => renderPriceValue(row.price) }
}

function bidAmountColumn<TRow extends { bidAmountAttoEth: bigint }>(): BidTableColumn<TRow> {
	return { label: forkAuctionCopy.bidAmountEth, render: row => <CurrencyValue value={row.bidAmountAttoEth} suffix={commonCopy.eth} /> }
}

function statusColumn<TRow extends BidTableRow>(): BidTableColumn<TRow> {
	return { className: 'truth-auction-bid-row-status', label: commonCopy.status, render: row => <span className={`truth-auction-status-pill ${row.statusToneClassName}`}>{row.statusLabel}</span> }
}

function BidTable<TRow extends BidTableRow>({ columns, regionClassName, regionLabel, rowClassName, rows, tableLabel }: { columns: readonly BidTableColumn<TRow>[]; regionClassName: string; regionLabel: string; rowClassName: string; rows: readonly TRow[]; tableLabel: string }) {
	if (rows.length === 0) return undefined
	return (
		<div className={regionClassName} role='region' aria-label={regionLabel} tabIndex={0}>
			<div className='truth-auction-bid-table' role='table' aria-label={tableLabel}>
				<div className={`${rowClassName} is-header`} role='row'>
					{columns.map(column => (
						<span className={column.className} key={column.label} role='columnheader'>
							{column.label}
						</span>
					))}
				</div>
				{rows.map(row => (
					<div className={rowClassName} key={row.key} role='row'>
						{columns.map(column =>
							column.blockCellClassName === undefined ? (
								<span className={column.className} data-label={column.label} key={column.label} role='cell'>
									{column.render(row)}
								</span>
							) : (
								<div className={column.blockCellClassName} data-label={column.label} key={column.label} role='cell'>
									{column.render(row)}
								</div>
							),
						)}
					</div>
				))}
			</div>
		</div>
	)
}

function hasVisibleEstimate(estimate: ViewerTruthAuctionBidRowViewModel['estimate']) {
	return estimate !== undefined && (estimate.repAttoRep > 0n || estimate.refundAttoEth > 0n)
}

function ViewerBidEstimate({ estimate }: { estimate: ViewerTruthAuctionBidRowViewModel['estimate'] }) {
	if (estimate === undefined || !hasVisibleEstimate(estimate)) return <>{commonCopy.metricUnavailablePlaceholder}</>
	return (
		<span className='truth-auction-bid-estimate'>
			{estimate.repAttoRep === 0n ? undefined : <CurrencyValue value={estimate.repAttoRep} suffix={commonCopy.rep} />}
			{estimate.refundAttoEth === 0n ? undefined : <CurrencyValue value={estimate.refundAttoEth} suffix={forkAuctionCopy.ethRefundSuffix} />}
		</span>
	)
}

export function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, error, hasLoadedData = true, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, onRetry, renderPriceValue, retrying = false, rows }: TruthAuctionBidsSectionProps) {
	return (
		<SectionBlock title={forkAuctionCopy.currentBids} variant='embedded'>
			{hasLoadedData && hasMoreAggregatedAuctionBids ? <p className='detail'>{forkAuctionCopy.formatShownBidCount(rows.length.toString(), aggregatedAuctionBidCountForLoadedTicks.toString())}</p> : undefined}
			{loadingAggregatedAuctionBids ? (
				<p className='detail'>
					<LoadingText>{forkAuctionCopy.loadingAuctionBids}</LoadingText>
				</p>
			) : undefined}
			<RetryableNotice disabled={retrying} message={error} onRetry={onRetry} retryAriaLabel={forkAuctionCopy.retryCurrentBids} retryLabel={retrying ? <LoadingText>{forkAuctionCopy.retryingAuctionBids}</LoadingText> : forkAuctionCopy.retryAuctionBids} />
			{hasLoadedData && error === undefined && !loadingAggregatedAuctionBids && loadedTickCount === 0 ? <p className='detail'>{forkAuctionCopy.auctionPriceLevelsEmpty}</p> : undefined}
			{hasLoadedData && error === undefined && !loadingAggregatedAuctionBids && loadedTickCount > 0 && rows.length === 0 ? <p className='detail'>{forkAuctionCopy.loadedPriceBidsEmpty}</p> : undefined}
			<BidTable
				columns={[priceColumn(renderPriceValue), { blockCellClassName: 'truth-auction-bid-row-address', label: forkAuctionCopy.bidder, render: row => <AddressValue address={row.bidder} copyable={false} /> }, bidAmountColumn(), statusColumn()]}
				regionClassName='truth-auction-bid-table-scroll'
				regionLabel={forkAuctionCopy.scrollableAuctionBidHistory}
				rowClassName='truth-auction-bid-row is-wide is-no-actions'
				rows={rows}
				tableLabel={forkAuctionCopy.auctionBidHistory}
			/>
			{error === undefined && hasMoreAggregatedAuctionBids ? <PaginationControls hasNextPage={hasMoreAggregatedAuctionBids} loading={loadingAggregatedAuctionBids} onLoadMore={onLoadNextAuctionBidPage} loadMoreLabel={forkAuctionCopy.loadMoreTruthAuctionBids} /> : undefined}
		</SectionBlock>
	)
}

export function ViewerTruthAuctionBidsSection({
	accountAddress,
	error,
	hasLoadedData = true,
	hasMoreViewerBids,
	loadingTruthAuctionBook,
	onLoadNextViewerBidPage,
	onRetry,
	onSettlementBidSelectionChange,
	onSettlementBidSelectionReplace,
	renderPriceValue,
	retrying = false,
	rows,
	showSettlementActionColumn,
}: ViewerTruthAuctionBidsSectionProps) {
	const selectableBidKeys = rows.flatMap(row => (row.settlementControl === undefined || row.settlementControl.disabled ? [] : [row.settlementControl.bidKey]))
	// Settled bids have no pending outcome, so the estimate column only appears while some bid still has one.
	const showEstimate = rows.some(row => hasVisibleEstimate(row.estimate))
	const checkedBidKeys = rows.flatMap(row => (row.settlementControl?.checked === true ? [row.settlementControl.bidKey] : []))
	return (
		<SectionBlock title={forkAuctionCopy.myBids} variant='embedded'>
			{accountAddress === undefined ? <p className='detail'>{forkAuctionCopy.walletBidsConnectionRequired}</p> : undefined}
			{accountAddress !== undefined && loadingTruthAuctionBook ? (
				<p className='detail'>
					<LoadingText>{forkAuctionCopy.loadingYourBids}</LoadingText>
				</p>
			) : undefined}
			<RetryableNotice disabled={retrying} message={error} onRetry={onRetry} retryAriaLabel={forkAuctionCopy.retryMyBids} retryLabel={retrying ? <LoadingText>{forkAuctionCopy.retryingAuctionBids}</LoadingText> : forkAuctionCopy.retryAuctionBids} />
			{accountAddress !== undefined && hasLoadedData && error === undefined && !loadingTruthAuctionBook && rows.length === 0 ? <p className='detail'>{forkAuctionCopy.walletBidsEmpty}</p> : undefined}
			{!showSettlementActionColumn || selectableBidKeys.length === 0 ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={selectableBidKeys.every(bidKey => checkedBidKeys.includes(bidKey))} onClick={() => onSettlementBidSelectionReplace(selectableBidKeys)} type='button'>
						{forkAuctionCopy.selectAllBids}
					</button>
					<button className='secondary' disabled={checkedBidKeys.length === 0} onClick={() => onSettlementBidSelectionReplace([])} type='button'>
						{forkAuctionCopy.clearBidSelection}
					</button>
				</div>
			)}
			<BidTable
				columns={[
					...(showSettlementActionColumn
						? [
								{
									blockCellClassName: 'truth-auction-bid-row-actions',
									label: commonCopy.selected,
									render: (row: ViewerTruthAuctionBidRowViewModel) => {
										const settlementControl = row.settlementControl
										if (settlementControl === undefined) return undefined
										return <input disabled={settlementControl.disabled} type='checkbox' checked={settlementControl.checked} title={settlementControl.title} aria-label={settlementControl.ariaLabel} onChange={event => onSettlementBidSelectionChange(settlementControl.bidKey, event.currentTarget.checked)} />
									},
								},
							]
						: []),
					priceColumn(renderPriceValue),
					bidAmountColumn(),
					...(showEstimate ? [{ label: forkAuctionCopy.estimatedResult, render: (row: ViewerTruthAuctionBidRowViewModel) => <ViewerBidEstimate estimate={row.estimate} /> }] : []),
					statusColumn(),
				]}
				regionClassName='truth-auction-bid-table-scroll is-wallet'
				regionLabel={forkAuctionCopy.scrollableMyBids}
				rowClassName={`truth-auction-bid-row is-wallet ${showSettlementActionColumn ? '' : 'is-no-actions'} ${showEstimate ? '' : 'is-no-estimate'}`}
				rows={rows}
				tableLabel={forkAuctionCopy.myBids}
			/>
			{accountAddress !== undefined && error === undefined && hasMoreViewerBids ? <PaginationControls hasNextPage={hasMoreViewerBids} loading={loadingTruthAuctionBook} onLoadMore={onLoadNextViewerBidPage} loadMoreLabel={forkAuctionCopy.loadMoreOfMyBids} /> : undefined}
		</SectionBlock>
	)
}
