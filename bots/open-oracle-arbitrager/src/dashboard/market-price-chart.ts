import type { PublicOperatorSnapshot } from '#state/operator-state'
import { chartTimeTickIndexes, countLabel, marketPriceChartDescription, selectedTokenPriceHistory } from './dashboard-format.js'
import { element, headingRow, row, setText, shorten } from './dom.js'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const SERIES_COLORS = ['#77e0ad', '#88b8ff', '#f0c36b', '#ff8b8b', '#c69cff', '#63d6e5']
const SERIES_DASHES = ['', '10 6', '3 5', '14 5 3 5', '2 3', '18 6']

function svgText(value: string, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'start') {
	const label = document.createElementNS(SVG_NAMESPACE, 'text')
	label.textContent = value
	label.setAttribute('x', x.toString())
	label.setAttribute('y', y.toString())
	label.setAttribute('text-anchor', anchor)
	return label
}

function chartPrice(value: number) {
	return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 5, notation: 'scientific' }).format(value)
}

export function renderMarketPriceChart(snapshot: Pick<PublicOperatorSnapshot, 'priceHistory'>) {
	const selector = element('price-token', HTMLSelectElement)
	const selected = selector.value
	const tokens = [...new Map(snapshot.priceHistory.map(point => [point.token.toLowerCase(), { address: point.token, symbol: point.symbol }])).values()]
	selector.replaceChildren(...tokens.map(token => new Option(`${token.symbol} · ${shorten(token.address)}`, token.address)))
	if (tokens.some(token => token.address === selected)) selector.value = selected
	const token = selector.value
	const points = selectedTokenPriceHistory(snapshot.priceHistory, token)
	const container = element('market-price-chart')
	const previousSamples = container.querySelector<HTMLDetailsElement>('details.chart-data')
	const samplesWereOpen = previousSamples?.open === true
	const samplesWereFocused = previousSamples?.querySelector('summary') === document.activeElement
	container.replaceChildren()
	setText('price-point-count', `${countLabel(points.length, 'persisted sample')}`)
	const finitePoints = points.filter(point => Number.isFinite(Number(point.priceWeth)))
	if (finitePoints.length === 0) {
		container.textContent = 'No quoted price samples are available for this token.'
		return
	}
	const values = finitePoints.map(point => Number(point.priceWeth))
	const minimum = Math.min(...values)
	const maximum = Math.max(...values)
	const range = maximum - minimum || Math.max(maximum, 1)
	const width = Math.max(container.clientWidth, 320)
	const compact = width < 600
	const height = compact ? 300 : 270
	const plot = { bottom: compact ? 250 : 220, left: 105, right: width - 70, top: 24 }
	const plotWidth = plot.right - plot.left
	const plotHeight = plot.bottom - plot.top
	const orderedPoints = [...finitePoints].sort((left, right) => Date.parse(left.sampledAt) - Date.parse(right.sampledAt))
	const times = orderedPoints.map(point => Date.parse(point.sampledAt))
	const first = Math.min(...times)
	const last = Math.max(...times)
	const timeRange = last - first || 1
	const series = [...new Map(finitePoints.map(point => [point.pool.toLowerCase(), point.venue])).entries()]
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
	svg.setAttribute('viewBox', `0 0 ${width.toString()} ${height.toString()}`)
	svg.setAttribute('role', 'img')
	const titleId = 'market-price-chart-title'
	const descriptionId = 'market-price-chart-description'
	svg.setAttribute('aria-labelledby', `${titleId} ${descriptionId}`)
	const title = document.createElementNS(SVG_NAMESPACE, 'title')
	title.id = titleId
	title.textContent = `${points[0]?.symbol ?? 'Token'} spot price in WETH by exchange pool`
	const description = document.createElementNS(SVG_NAMESPACE, 'desc')
	description.id = descriptionId
	description.textContent = marketPriceChartDescription(orderedPoints)
	svg.append(title, description)
	for (const fraction of [0, 0.5, 1]) {
		const y = plot.bottom - fraction * plotHeight
		const value = minimum + fraction * range
		const grid = document.createElementNS(SVG_NAMESPACE, 'line')
		grid.setAttribute('x1', plot.left.toString())
		grid.setAttribute('x2', plot.right.toString())
		grid.setAttribute('y1', y.toString())
		grid.setAttribute('y2', y.toString())
		grid.setAttribute('class', 'chart-grid')
		svg.append(grid, svgText(`${chartPrice(value)} WETH`, plot.left - 10, y + 4, 'end'))
	}
	const xTicks = chartTimeTickIndexes(times, compact, plotWidth)
		.map(index => orderedPoints[index])
		.filter(point => point !== undefined)
	for (const point of xTicks) {
		const x = plot.left + ((Date.parse(point.sampledAt) - first) / timeRange) * plotWidth
		const blockLabel = svgText(`Block ${point.blockNumber}`, x, height - 26, 'middle')
		const timeLabel = svgText(new Date(point.sampledAt).toLocaleTimeString(), x, height - 8, 'middle')
		blockLabel.setAttribute('class', 'chart-axis-label')
		timeLabel.setAttribute('class', 'chart-axis-label')
		svg.append(blockLabel, timeLabel)
	}
	for (const [index, [pool]] of series.entries()) {
		const poolPoints = orderedPoints.filter(point => point.pool.toLowerCase() === pool)
		const coordinates = poolPoints.map(point => {
			const x = plot.left + ((Date.parse(point.sampledAt) - first) / timeRange) * plotWidth
			const y = plot.bottom - ((Number(point.priceWeth) - minimum) / range) * plotHeight
			return { point, x, y }
		})
		const polyline = document.createElementNS(SVG_NAMESPACE, 'polyline')
		polyline.setAttribute('points', coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '))
		polyline.setAttribute('fill', 'none')
		polyline.setAttribute('stroke', SERIES_COLORS[index % SERIES_COLORS.length] ?? '#77e0ad')
		polyline.setAttribute('stroke-dasharray', SERIES_DASHES[index % SERIES_DASHES.length] ?? '')
		polyline.setAttribute('stroke-width', '3')
		polyline.setAttribute('vector-effect', 'non-scaling-stroke')
		svg.append(polyline)
		for (const { point, x, y } of coordinates) {
			const marker = document.createElementNS(SVG_NAMESPACE, 'circle')
			marker.setAttribute('cx', x.toFixed(2))
			marker.setAttribute('cy', y.toFixed(2))
			marker.setAttribute('r', '4')
			marker.setAttribute('fill', SERIES_COLORS[index % SERIES_COLORS.length] ?? '#77e0ad')
			const tooltip = document.createElementNS(SVG_NAMESPACE, 'title')
			tooltip.textContent = `${point.venue}: ${point.priceWeth} WETH at block ${point.blockNumber}, ${new Date(point.sampledAt).toLocaleString()}`
			marker.append(tooltip)
			svg.append(marker)
		}
	}
	const legend = document.createElement('div')
	legend.className = 'chart-legend'
	for (const [index, [pool, venue]] of series.entries()) {
		const item = document.createElement('span')
		item.style.setProperty('--series-color', SERIES_COLORS[index % SERIES_COLORS.length] ?? '#77e0ad')
		item.textContent = `${venue} · ${shorten(pool)}`
		legend.append(item)
	}
	const samples = document.createElement('details')
	samples.className = 'chart-data'
	const summary = document.createElement('summary')
	summary.dataset['focusKey'] = `price-samples:${token}:summary`
	const recentPoints = orderedPoints.slice(-100).reverse()
	summary.textContent = `Recent exact price samples (${recentPoints.length.toString()} of ${countLabel(finitePoints.length, 'sample')})`
	const tableScroll = document.createElement('div')
	tableScroll.className = 'table-scroll'
	tableScroll.tabIndex = 0
	tableScroll.setAttribute('aria-label', 'Recent exact token price samples')
	const table = document.createElement('table')
	const head = document.createElement('thead')
	head.append(headingRow(['Block', 'Observed', 'Exchange pool', 'Price']))
	const body = document.createElement('tbody')
	for (const point of recentPoints) body.append(row([point.blockNumber, new Date(point.sampledAt).toLocaleString(), point.venue, `${point.priceWeth} WETH`]))
	table.append(head, body)
	tableScroll.append(table)
	samples.append(summary, tableScroll)
	container.append(svg, legend, samples)
	samples.open = samplesWereOpen
	if (samplesWereFocused) summary.focus({ preventScroll: true })
}
