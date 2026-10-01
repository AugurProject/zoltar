import type { PublicExecutionRecord } from '#state/operator-state'
import { chartPointX, countLabel, exactAmount, sumSignedDecimals } from './dashboard-format.ts'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Draws the cumulative tracked net profit of the displayed submitted disputes, oldest first. */
export function renderProfitChart(container: HTMLElement, history: readonly PublicExecutionRecord[], recordCount: number) {
	container.replaceChildren()
	if (history.length === 0) return
	const chronological = [...history].reverse()
	let total = 0
	const values = chronological.map(record => {
		total += Number(record.trackedNetProfitEth)
		return total
	})
	const minimum = Math.min(0, ...values)
	const maximum = Math.max(0, ...values)
	const range = maximum - minimum || 1
	const width = Math.max(container.clientWidth, 320)
	const height = 90
	const points = values.map((value, index) => {
		const x = chartPointX(index, values.length, width)
		const y = height - ((value - minimum) / range) * (height - 16) - 8
		return `${x.toFixed(2)},${y.toFixed(2)}`
	})
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
	svg.setAttribute('viewBox', `0 0 ${width.toString()} ${height.toString()}`)
	svg.setAttribute('role', 'img')
	const title = document.createElementNS(SVG_NAMESPACE, 'title')
	title.textContent = 'Tracked net profit in ETH for the displayed submitted disputes'
	const baseline = document.createElementNS(SVG_NAMESPACE, 'line')
	const baselineY = height - ((0 - minimum) / range) * (height - 16) - 8
	baseline.setAttribute('x1', '0')
	baseline.setAttribute('x2', width.toString())
	baseline.setAttribute('y1', baselineY.toFixed(2))
	baseline.setAttribute('y2', baselineY.toFixed(2))
	baseline.setAttribute('stroke', '#273141')
	const polyline = document.createElementNS(SVG_NAMESPACE, 'polyline')
	polyline.setAttribute('points', points.join(' '))
	polyline.setAttribute('fill', 'none')
	polyline.setAttribute('stroke', '#77e0ad')
	polyline.setAttribute('stroke-width', '3')
	polyline.setAttribute('vector-effect', 'non-scaling-stroke')
	svg.append(title, baseline, polyline)
	if (values.length === 1) {
		const [x = '0', y = '0'] = points[0]?.split(',') ?? []
		const marker = document.createElementNS(SVG_NAMESPACE, 'circle')
		marker.setAttribute('cx', x)
		marker.setAttribute('cy', y)
		marker.setAttribute('fill', '#77e0ad')
		marker.setAttribute('r', '6')
		svg.append(marker)
	}
	const summary = document.createElement('div')
	summary.className = 'profit-chart-summary'
	const label = document.createElement('span')
	label.textContent = recordCount > history.length ? `Tracked net profit · latest ${history.length.toString()} of ${recordCount.toString()} records` : `Tracked net profit · ${countLabel(recordCount, 'record')}`
	const value = document.createElement('strong')
	value.textContent = exactAmount(sumSignedDecimals(chronological.map(record => record.trackedNetProfitEth)), 'ETH')
	summary.append(label, value)
	container.append(summary, svg)
}
