import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TruthAuctionDepthChart } from './TruthAuctionDepthChart.js'
import { getTruthAuctionDispositionClassName, type TruthAuctionDepthPoint } from '../lib/truthAuctionBook.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'

type TruthAuctionMarketViewSectionProps = {
	clearingTick: bigint | undefined
	hasMoreTickSummaries: boolean
	loadingTruthAuctionBook: boolean
	maxTickAttoEth: bigint
	onLoadNextTickPage: () => void
	onSelectTick: (tick: bigint) => void
	renderPriceValue: (value: bigint | undefined) => ComponentChildren
	showDepthClearingTick: boolean
	truthAuctionBookError: string | undefined
	truthAuctionDepthPoints: TruthAuctionDepthPoint[]
}

function clampPercentage(value: bigint, maxValue: bigint) {
	return (getVisualRatio({ value, maxValue }) ?? 0) * 100
}

export function TruthAuctionMarketViewSection({ clearingTick, hasMoreTickSummaries, loadingTruthAuctionBook, maxTickAttoEth, onLoadNextTickPage, onSelectTick, renderPriceValue, showDepthClearingTick, truthAuctionBookError, truthAuctionDepthPoints }: TruthAuctionMarketViewSectionProps) {
	return (
		<SectionBlock variant='embedded'>
			{truthAuctionBookError === undefined ? undefined : <UserMessage className='detail truth-auction-book-error' tone='error' detail={truthAuctionBookError} />}
			<div className='truth-auction-market-board'>
				<div className='truth-auction-market-section truth-auction-depth-panel'>
					<div className='truth-auction-depth-header'>
						<div>
							<h4>{forkAuctionCopy.visibleDepth}</h4>
						</div>
					</div>
					{loadingTruthAuctionBook ? <UserMessage className='detail' loading detail={forkAuctionCopy.loadingOrderBook} /> : undefined}
					{truthAuctionBookError === undefined && !loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <UserMessage className='detail' detail={forkAuctionCopy.auctionLiveLevelsEmpty} /> : undefined}
					{truthAuctionDepthPoints.length === 0 ? undefined : <TruthAuctionDepthChart onSelectTick={onSelectTick} points={truthAuctionDepthPoints} {...(showDepthClearingTick && clearingTick !== undefined ? { clearingTick } : {})} />}
				</div>
				<div className='truth-auction-market-detail-grid'>
					<div className='truth-auction-market-section'>
						<div className='truth-auction-panel-header'>
							<div>
								<h4>{forkAuctionCopy.priceLadder}</h4>
								{truthAuctionDepthPoints.length === 0 ? undefined : <UserMessage className='detail' detail={forkAuctionCopy.priceLadderHint} />}
							</div>
						</div>
						<div className='truth-auction-ladder'>
							{loadingTruthAuctionBook ? <UserMessage className='detail' loading detail={forkAuctionCopy.loadingPriceLevels} /> : undefined}
							{truthAuctionBookError === undefined && !loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <UserMessage className='detail' detail={forkAuctionCopy.visibleAuctionLevelsEmpty} /> : undefined}
							{truthAuctionDepthPoints.map(point => (
								<button
									aria-pressed={point.isSelected}
									className={`truth-auction-price-row truth-auction-ladder-row ${getTruthAuctionDispositionClassName(point.disposition.tone)}${point.isSelected ? ' is-selected' : ''}${point.isPreviewTick ? ' is-preview' : ''}${showDepthClearingTick && clearingTick === point.tick ? ' is-clearing' : ''}`}
									key={point.tick.toString()}
									onClick={() => onSelectTick(point.tick)}
									type='button'
								>
									<div className='truth-auction-price-row-bar' style={{ width: `${clampPercentage(point.currentTotalBidAttoEth, maxTickAttoEth)}%` }} />
									<div className='truth-auction-price-row-copy'>
										<div className='truth-auction-price-row-main'>
											<strong>{renderPriceValue(point.price)}</strong>
											<div className='truth-auction-price-row-badges'>
												{point.isPreviewTick ? <span className='truth-auction-ladder-helper'>{forkAuctionCopy.currentFormPrice}</span> : undefined}
												<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(point.disposition.tone)}`}>{point.disposition.label}</span>
											</div>
										</div>
										<div className='truth-auction-price-row-meta'>
											<span>
												{forkAuctionCopy.currentSize} <CurrencyValue value={point.currentTotalBidAttoEth} suffix={commonCopy.eth} />
											</span>
											<span className='truth-auction-ladder-row-cumulative'>
												{forkAuctionCopy.loadedDepth} <CurrencyValue value={point.cumulativeBidAttoEth} suffix={commonCopy.eth} />
											</span>
											<span>{forkAuctionCopy.formatSubmissionsLabel(point.submissionCount.toString())}</span>
										</div>
									</div>
								</button>
							))}
							{truthAuctionBookError === undefined && hasMoreTickSummaries ? <PaginationControls hasNextPage={hasMoreTickSummaries} loading={loadingTruthAuctionBook} onLoadMore={onLoadNextTickPage} loadMoreLabel={forkAuctionCopy.loadMorePriceLevels} /> : undefined}
						</div>
					</div>
				</div>
			</div>
		</SectionBlock>
	)
}
