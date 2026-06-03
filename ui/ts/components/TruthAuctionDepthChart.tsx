import { useRef } from 'preact/hooks'
import { CurrencyValue } from './CurrencyValue.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'

type TruthAuctionDisposition = {
	label: string
	tone: 'default' | 'danger' | 'success' | 'warning'
}

export type TruthAuctionDepthPoint = {
	tick: bigint
	price: bigint
	currentTotalEth: bigint
	cumulativeEth: bigint
	disposition: TruthAuctionDisposition
	isSelected: boolean
	isPreviewTick: boolean
}

type TruthAuctionDepthChartProps = {
	clearingTick?: bigint
	loadedTickCount: number
	onSelectTick: (tick: bigint) => void
	points: TruthAuctionDepthPoint[]
	totalActiveTickCount: bigint
}

const CHART_WIDTH = 560
const CHART_HEIGHT = 180
const DEPTH_RATIO_SCALE = 1_000_000n
const CHART_PADDING = {
	bottom: 22,
	left: 6,
	right: 6,
	top: 10,
}
let nextDepthGradientId = 0

function getDepthRatio(value: bigint, maxDepth: bigint) {
	if (value <= 0n || maxDepth <= 0n) return 0
	return Number((value * DEPTH_RATIO_SCALE) / maxDepth) / Number(DEPTH_RATIO_SCALE)
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

export function TruthAuctionDepthChart({ clearingTick, loadedTickCount, onSelectTick, points, totalActiveTickCount }: TruthAuctionDepthChartProps) {
	if (points.length === 0) return null

	const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
	const visibleCoverageText = `Showing ${loadedTickCount.toString()} of ${totalActiveTickCount.toString()} active price levels`
	const gradientIdRef = useRef<string | undefined>(undefined)
	if (gradientIdRef.current === undefined) {
		gradientIdRef.current = `truth-auction-depth-fill-${nextDepthGradientId.toString()}`
		nextDepthGradientId += 1
	}
	const gradientId = gradientIdRef.current

	return (
		<>
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
			<div className='truth-auction-depth-legend'>
				<div className='truth-auction-depth-legend-copy'>
					<strong>Visible depth from loaded price levels</strong>
					<span>{visibleCoverageText}</span>
				</div>
				{points[0] === undefined ? undefined : (
					<div className='truth-auction-depth-legend-range'>
						<span>
							Highest loaded price <CurrencyValue value={points[0].price} suffix='ETH / REP' />
						</span>
						<span>
							Loaded depth <CurrencyValue value={points[points.length - 1]?.cumulativeEth} suffix='ETH' />
						</span>
					</div>
				)}
			</div>
		</>
	)
}
