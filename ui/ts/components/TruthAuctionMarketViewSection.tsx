import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { PaginationControls } from './PaginationControls.js'
import { SectionBlock } from './SectionBlock.js'
import { TruthAuctionDepthChart } from './TruthAuctionDepthChart.js'
import { getTruthAuctionDispositionClassName, type TruthAuctionDepthPoint } from '../lib/truthAuctionBook.js'
import { getVisualRatio } from '../lib/visualMetrics.js'
import {
	UI_STRING_CLEARING_LEVEL,
	UI_STRING_CURRENT_FORM_PRICE,
	UI_STRING_CURRENT_SIZE,
	UI_STRING_ETH,
	UI_STRING_LOAD_MORE_PRICE_LEVELS,
	UI_STRING_LOADED_DEPTH,
	UI_STRING_LOADING_ORDER_BOOK,
	UI_STRING_LOADING_PRICE_LEVELS,
	UI_STRING_MARKET_VIEW,
	UI_STRING_NO_ACTIVE_LEVELS_ARE_VISIBLE,
	UI_STRING_NO_LIVE_PRICE_LEVELS_ARE_CURRENTLY_ACTIVE_FOR_THIS_AUCTION,
	UI_STRING_PRICE_LADDER,
	UI_STRING_PRICE_LEVEL,
	UI_STRING_VISIBLE_DEPTH,
	UI_TEMPLATE_SUBMISSIONS_LABEL,
} from '../lib/uiStrings.js'

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
		<SectionBlock title={UI_STRING_MARKET_VIEW}>
			{truthAuctionBookError === undefined ? undefined : <p className='detail truth-auction-book-error'>{truthAuctionBookError}</p>}
			<div className='truth-auction-market-board'>
				<div className='truth-auction-market-section truth-auction-depth-panel'>
					<div className='truth-auction-depth-header'>
						<div>
							<h4>{UI_STRING_VISIBLE_DEPTH}</h4>
						</div>
					</div>
					{loadingTruthAuctionBook ? <p className='detail'>{UI_STRING_LOADING_ORDER_BOOK}</p> : undefined}
					{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>{UI_STRING_NO_LIVE_PRICE_LEVELS_ARE_CURRENTLY_ACTIVE_FOR_THIS_AUCTION}</p> : undefined}
					{truthAuctionDepthPoints.length === 0 ? undefined : <TruthAuctionDepthChart onSelectTick={onSelectTick} points={truthAuctionDepthPoints} {...(showDepthClearingTick && clearingTick !== undefined ? { clearingTick } : {})} />}
				</div>
				<div className='truth-auction-market-detail-grid'>
					<div className='truth-auction-market-section'>
						<div className='truth-auction-panel-header'>
							<div>
								<h4>{UI_STRING_PRICE_LADDER}</h4>
							</div>
						</div>
						<div className='truth-auction-ladder'>
							{loadingTruthAuctionBook ? <p className='detail'>{UI_STRING_LOADING_PRICE_LEVELS}</p> : undefined}
							{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>{UI_STRING_NO_ACTIVE_LEVELS_ARE_VISIBLE}</p> : undefined}
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
												<span className='truth-auction-price-row-price'>{UI_STRING_PRICE_LEVEL}</span>
											</div>
											<div className='truth-auction-price-row-badges'>
												{clearingTick === point.tick ? <span className='truth-auction-ladder-helper'>{UI_STRING_CLEARING_LEVEL}</span> : undefined}
												{point.isPreviewTick ? <span className='truth-auction-ladder-helper'>{UI_STRING_CURRENT_FORM_PRICE}</span> : undefined}
												<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(point.disposition.tone)}`}>{point.disposition.label}</span>
											</div>
										</div>
										<div className='truth-auction-price-row-meta'>
											<span>
												{UI_STRING_CURRENT_SIZE} <CurrencyValue value={point.currentTotalEth} suffix={UI_STRING_ETH} />
											</span>
											<span className='truth-auction-ladder-row-cumulative'>
												{UI_STRING_LOADED_DEPTH} <CurrencyValue value={point.cumulativeEth} suffix={UI_STRING_ETH} />
											</span>
											<span>{UI_TEMPLATE_SUBMISSIONS_LABEL(point.submissionCount.toString())}</span>
										</div>
									</div>
								</button>
							))}
							{hasMoreTickSummaries ? <PaginationControls hasNextPage={hasMoreTickSummaries} onLoadMore={onLoadNextTickPage} loadMoreLabel={UI_STRING_LOAD_MORE_PRICE_LEVELS} /> : undefined}
						</div>
					</div>
				</div>
			</div>
		</SectionBlock>
	)
}
