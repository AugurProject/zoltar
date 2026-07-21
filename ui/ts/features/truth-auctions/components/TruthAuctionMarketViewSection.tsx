import * as commonCopy from '../../../copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TruthAuctionDepthChart } from './TruthAuctionDepthChart.js'
import { getTruthAuctionDispositionClassName, type TruthAuctionDepthPoint } from '../lib/truthAuctionBook.js'
import { getVisualRatio } from '../../../lib/visualMetrics.js'

type TruthAuctionMarketViewSectionProps = {
	clearingTick: bigint | undefined
	hasMoreTickSummaries: boolean
	loadingTruthAuctionBook: boolean
	maxTickEth: bigint
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

export function TruthAuctionMarketViewSection({ clearingTick, hasMoreTickSummaries, loadingTruthAuctionBook, maxTickEth, onLoadNextTickPage, onSelectTick, renderPriceValue, showDepthClearingTick, truthAuctionBookError, truthAuctionDepthPoints }: TruthAuctionMarketViewSectionProps) {
	return (
		<SectionBlock title={forkAuctionCopy.marketView} variant='embedded'>
			{truthAuctionBookError === undefined ? undefined : <p className='detail truth-auction-book-error'>{truthAuctionBookError}</p>}
			<div className='truth-auction-market-board'>
				<div className='truth-auction-market-section truth-auction-depth-panel'>
					<div className='truth-auction-depth-header'>
						<div>
							<h4>{forkAuctionCopy.visibleDepth}</h4>
						</div>
					</div>
					{loadingTruthAuctionBook ? <p className='detail'>{forkAuctionCopy.loadingOrderBook}</p> : undefined}
					{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>{forkAuctionCopy.auctionLiveLevelsEmpty}</p> : undefined}
					{truthAuctionDepthPoints.length === 0 ? undefined : <TruthAuctionDepthChart onSelectTick={onSelectTick} points={truthAuctionDepthPoints} {...(showDepthClearingTick && clearingTick !== undefined ? { clearingTick } : {})} />}
				</div>
				<div className='truth-auction-market-detail-grid'>
					<div className='truth-auction-market-section'>
						<div className='truth-auction-panel-header'>
							<div>
								<h4>{forkAuctionCopy.priceLadder}</h4>
							</div>
						</div>
						<div className='truth-auction-ladder'>
							{loadingTruthAuctionBook ? <p className='detail'>{forkAuctionCopy.loadingPriceLevels}</p> : undefined}
							{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>{forkAuctionCopy.visibleAuctionLevelsEmpty}</p> : undefined}
							{truthAuctionDepthPoints.map(point => (
								<button
									aria-pressed={point.isSelected}
									className={`truth-auction-price-row truth-auction-ladder-row ${getTruthAuctionDispositionClassName(point.disposition.tone)}${point.isSelected ? ' is-selected' : ''}${point.isPreviewTick ? ' is-preview' : ''}${clearingTick === point.tick ? ' is-clearing' : ''}`}
									key={point.tick.toString()}
									onClick={() => onSelectTick(point.tick)}
									type='button'
								>
									<div className='truth-auction-price-row-bar' style={{ width: `${clampPercentage(point.currentTotalEth, maxTickEth)}%` }} />
									<div className='truth-auction-price-row-copy'>
										<div className='truth-auction-price-row-main'>
											<div>
												<strong>{renderPriceValue(point.price)}</strong>
												<span className='truth-auction-price-row-price'>{forkAuctionCopy.priceLevel}</span>
											</div>
											<div className='truth-auction-price-row-badges'>
												{clearingTick === point.tick ? <span className='truth-auction-ladder-helper'>{forkAuctionCopy.clearingLevel}</span> : undefined}
												{point.isPreviewTick ? <span className='truth-auction-ladder-helper'>{forkAuctionCopy.currentFormPrice}</span> : undefined}
												<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(point.disposition.tone)}`}>{point.disposition.label}</span>
											</div>
										</div>
										<div className='truth-auction-price-row-meta'>
											<span>
												{forkAuctionCopy.currentSize} <CurrencyValue value={point.currentTotalEth} suffix={commonCopy.eth} />
											</span>
											<span className='truth-auction-ladder-row-cumulative'>
												{forkAuctionCopy.loadedDepth} <CurrencyValue value={point.cumulativeEth} suffix={commonCopy.eth} />
											</span>
											<span>{forkAuctionCopy.formatSubmissionsLabel(point.submissionCount.toString())}</span>
										</div>
									</div>
								</button>
							))}
							{hasMoreTickSummaries ? <PaginationControls hasNextPage={hasMoreTickSummaries} onLoadMore={onLoadNextTickPage} loadMoreLabel={forkAuctionCopy.loadMorePriceLevels} /> : undefined}
						</div>
					</div>
				</div>
			</div>
		</SectionBlock>
	)
}
