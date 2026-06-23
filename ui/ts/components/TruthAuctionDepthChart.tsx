import { useRef } from 'preact/hooks'
import { CurrencyValue } from './CurrencyValue.js'
import { formatCurrencyInputBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { getVisualRatio } from '../lib/visualMetrics.js'
import type { TruthAuctionDepthPoint } from '../lib/truthAuctionBook.js'

type TruthAuctionDepthChartProps = {
	clearingTick?: bigint
	onSelectTick: (tick: bigint) => void
	points: TruthAuctionDepthPoint[]
}

const CHART_WIDTH = 560
const CHART_HEIGHT = 180
const CHART_PADDING = {
	bottom: 22,
	left: 6,
	right: 6,
	top: 10,
}
let nextDepthGradientId = 0

function formatTruthAuctionPriceLabel(price: bigint) {
	return `${formatRoundedCurrencyBalance(price, 18, 4)} ETH / REP`
}

function getDepthRatio(value: bigint, maxDepth: bigint) {
	return getVisualRatio({ value, maxValue: maxDepth }) ?? 0
}

function getMarkerClassName(point: TruthAuctionDepthPoint, clearingTick: bigint | undefined) {
	const classNames = ['truth-auction-depth-marker']

	if (point.tick === clearingTick) classNames.push('is-clearing')
	if (point.isSelected) classNames.push('is-selected')
	if (point.isPreviewTick) classNames.push('is-preview')

	return classNames.join(' ')
}

function buildDepthAreaPath(points: TruthAuctionDepthPoint[]) {
	if (points.length === 0) return ''

	const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
	const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
	const baselineY = CHART_HEIGHT - CHART_PADDING.bottom
	const stepWidth = plotWidth / points.length
	const maxDepth = points.reduce((currentMax, point) => (point.cumulativeEth > currentMax ? point.cumulativeEth : currentMax), 0n)
	const toY = (value: bigint) => {
		if (value <= 0n || maxDepth <= 0n) return baselineY
		return baselineY - getDepthRatio(value, maxDepth) * plotHeight
	}

	let path = `M ${CHART_PADDING.left} ${baselineY}`
	for (const [index, point] of points.entries()) {
		const xStart = CHART_PADDING.left + stepWidth * index
		const xEnd = CHART_PADDING.left + stepWidth * (index + 1)
		const y = toY(point.cumulativeEth)
		path += ` L ${xStart} ${y} L ${xEnd} ${y}`
	}
	path += ` L ${CHART_PADDING.left + plotWidth} ${baselineY} Z`

	return path
}

function buildDepthLinePath(points: TruthAuctionDepthPoint[]) {
	if (points.length === 0) return ''

	const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
	const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
	const baselineY = CHART_HEIGHT - CHART_PADDING.bottom
	const stepWidth = plotWidth / points.length
	const maxDepth = points.reduce((currentMax, point) => (point.cumulativeEth > currentMax ? point.cumulativeEth : currentMax), 0n)
	const toY = (value: bigint) => {
		if (value <= 0n || maxDepth <= 0n) return baselineY
		return baselineY - getDepthRatio(value, maxDepth) * plotHeight
	}

	let path = ''
	for (const [index, point] of points.entries()) {
		const xStart = CHART_PADDING.left + stepWidth * index
		const xEnd = CHART_PADDING.left + stepWidth * (index + 1)
		const y = toY(point.cumulativeEth)
		if (index === 0) path = `M ${xStart} ${y}`
		path += ` L ${xEnd} ${y}`
		if (index < points.length - 1) {
			const nextPoint = points[index + 1]
			if (nextPoint !== undefined) path += ` L ${xEnd} ${toY(nextPoint.cumulativeEth)}`
		}
	}

	return path
}

export function TruthAuctionDepthChart({ clearingTick, onSelectTick, points }: TruthAuctionDepthChartProps) {
	if (points.length === 0) return null

	const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
	const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
	const baselineY = CHART_HEIGHT - CHART_PADDING.bottom
	const gradientIdRef = useRef<string | undefined>(undefined)
	if (gradientIdRef.current === undefined) {
		gradientIdRef.current = `truth-auction-depth-fill-${nextDepthGradientId.toString()}`
		nextDepthGradientId += 1
	}
	const gradientId = gradientIdRef.current
	const highestLoadedPrice = points[0]?.price
	const lowestLoadedPrice = points[points.length - 1]?.price
	const midpointIndex = points.length >= 3 ? Math.floor(points.length / 2) : undefined
	const midpointPrice = midpointIndex === undefined ? undefined : points[midpointIndex]?.price
	const maxLoadedDepth = points.reduce((currentMax, point) => (point.cumulativeEth > currentMax ? point.cumulativeEth : currentMax), 0n)
	const midpointDepth = maxLoadedDepth >= 2n ? maxLoadedDepth / 2n : undefined
	const getDepthYPosition = (value: bigint) => {
		if (value <= 0n || maxLoadedDepth <= 0n) return baselineY
		return baselineY - getDepthRatio(value, maxLoadedDepth) * plotHeight
	}

	return (
		<>
			<div className='truth-auction-depth-frame'>
				<div className='truth-auction-depth-y-axis'>
					<span className='truth-auction-depth-axis-title truth-auction-depth-axis-title-y'>Loaded Depth (ETH)</span>
					<div className='truth-auction-depth-y-ticks' aria-hidden='true'>
						<span className='truth-auction-depth-axis-tick truth-auction-depth-y-tick is-max' style={{ top: `${(getDepthYPosition(maxLoadedDepth) / CHART_HEIGHT) * 100}%` }}>
							<CurrencyValue copyable={false} value={maxLoadedDepth} suffix='ETH' />
						</span>
						{midpointDepth === undefined ? undefined : (
							<span className='truth-auction-depth-axis-tick truth-auction-depth-y-tick is-mid' style={{ top: `${(getDepthYPosition(midpointDepth) / CHART_HEIGHT) * 100}%` }}>
								<CurrencyValue copyable={false} value={midpointDepth} suffix='ETH' />
							</span>
						)}
						<span className='truth-auction-depth-axis-tick truth-auction-depth-y-tick is-min' style={{ top: `${(getDepthYPosition(0n) / CHART_HEIGHT) * 100}%` }}>
							0 ETH
						</span>
					</div>
				</div>
				<div className='truth-auction-depth-chart' role='group' aria-label='Truth auction visible depth chart'>
					<svg aria-hidden='true' viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio='none'>
						<defs>
							<linearGradient id={gradientId} x1='0%' x2='100%' y1='0%' y2='0%'>
								<stop offset='0%' stop-color='#e8a644' stop-opacity='0.28' />
								<stop offset='100%' stop-color='#3e9f78' stop-opacity='0.28' />
							</linearGradient>
						</defs>
						<rect className='truth-auction-depth-base' height={CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom} rx='14' ry='14' width={plotWidth} x={CHART_PADDING.left} y={CHART_PADDING.top} />
						<path className='truth-auction-depth-area' d={buildDepthAreaPath(points)} fill={`url(#${gradientId})`} />
						<path className='truth-auction-depth-line' d={buildDepthLinePath(points)} />
					</svg>
					<div className='truth-auction-depth-hit-targets'>
						{points.map((point, index) => (
							<button
								aria-label={`Select price ${formatCurrencyInputBalance(point.price)} ETH / REP from depth chart`}
								aria-pressed={point.isSelected}
								className='truth-auction-depth-hit-target'
								key={point.tick.toString()}
								onClick={() => onSelectTick(point.tick)}
								style={{
									left: `${(index / points.length) * 100}%`,
									width: `${100 / points.length}%`,
								}}
								type='button'
							>
								<span className={getMarkerClassName(point, clearingTick)}>
									<span className='truth-auction-depth-marker-dot' />
								</span>
							</button>
						))}
					</div>
				</div>
			</div>
			<div className={`truth-auction-depth-x-axis${midpointPrice === undefined ? ' no-midpoint' : ''}`}>
				{highestLoadedPrice === undefined ? undefined : <span className='truth-auction-depth-axis-tick truth-auction-depth-x-tick is-max'>{formatTruthAuctionPriceLabel(highestLoadedPrice)}</span>}
				{midpointPrice === undefined ? undefined : <span className='truth-auction-depth-axis-tick truth-auction-depth-x-tick is-mid'>{formatTruthAuctionPriceLabel(midpointPrice)}</span>}
				{lowestLoadedPrice === undefined ? undefined : <span className='truth-auction-depth-axis-tick truth-auction-depth-x-tick is-min'>{formatTruthAuctionPriceLabel(lowestLoadedPrice)}</span>}
			</div>
			<div className='truth-auction-depth-axis-title truth-auction-depth-axis-title-x'>Price (ETH / REP)</div>
		</>
	)
}
