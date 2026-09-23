import { type ChartDefinition } from './browser-types.ts'
import { requiredArrayItem } from './api-decoding.ts'
import { chartValueBounds } from './chart-values.ts'
import { element } from './view-presentation.ts'

export const exactUnit = (value: string | number | bigint | null | undefined, decimals = 18, symbol = '', maximumFraction = 3): string => {
	if (value === null || value === undefined) return '—'
	const negative = String(value).startsWith('-')
	const digits = String(value)
		.replace('-', '')
		.padStart(decimals + 1, '0')
	const whole = digits.slice(0, -decimals) || '0'
	const fraction = decimals === 0 ? '' : digits.slice(-decimals).slice(0, maximumFraction).replace(/0+$/, '')
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`
}

const compactValue = (value: string | number | bigint | null | undefined, decimals = 18): number => {
	if (value === null || value === undefined) return 0
	const digits = String(value)
	const scale = 10 ** Math.min(decimals, 18)
	return Number(digits) / scale
}

export const staticField = (label: string, value: string | number | bigint | null | undefined) => {
	const field = element('div', 'static-field')
	field.append(element('span', '', label), element('code', '', value === null || value === undefined ? '—' : String(value)))
	return field
}

export const metricCard = (label: string, value: string, detail?: string) => {
	const card = element('div', 'metric-card')
	card.append(element('span', '', label), element('strong', '', value))
	if (detail !== undefined) card.append(element('small', '', detail))
	return card
}

export const chartNumericValue = (value: unknown): string | number | bigint | null | undefined => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value === null || value === undefined ? value : undefined)

const chartTimestamp = (value: string): number => {
	const parsed = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value)
	return Number.isFinite(parsed) ? parsed : 0
}

const lineChart = <T extends { timestamp: string }>(rows: T[], definitions: ChartDefinition<T>[], { sharedRange, axisUnit = '' }: { sharedRange?: readonly [number, number]; axisUnit?: string } = {}) => {
	const width = 760
	const height = 190
	const margin = { left: 48, right: 14, top: 12, bottom: 28 }
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('class', 'time-chart')
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	svg.setAttribute('role', 'img')
	svg.setAttribute('aria-label', `${definitions.map(({ label }) => label).join(', ')} value over time`)
	const series = definitions.map(({ key, decimals = 18 }) => {
		const raw = rows.map(row => (row[key] === undefined ? Number.NaN : compactValue(chartNumericValue(row[key]), decimals)))
		return raw
	})
	const timestamps = rows.map(row => chartTimestamp(row.timestamp))
	const minimumTimestamp = Math.min(...timestamps)
	const timestampRange = Math.max(...timestamps) - minimumTimestamp
	const values = series.flat().filter(Number.isFinite)
	const { minimum, maximum } = chartValueBounds(values, sharedRange)
	const range = maximum - minimum
	const chartWidth = width - margin.left - margin.right
	const chartHeight = height - margin.top - margin.bottom
	for (let index = 0; index <= 3; index++) {
		const y = margin.top + (chartHeight * index) / 3
		const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line')
		grid.setAttribute('class', 'chart-grid-line')
		grid.setAttribute('x1', String(margin.left))
		grid.setAttribute('x2', String(width - margin.right))
		grid.setAttribute('y1', String(y))
		grid.setAttribute('y2', String(y))
		svg.append(grid)
		const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
		label.setAttribute('class', 'chart-axis-label')
		label.setAttribute('x', '2')
		label.setAttribute('y', String(y + 3))
		const axisValue = maximum - (range * index) / 3
		label.textContent = `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(axisValue)}${axisUnit}`
		svg.append(label)
	}
	definitions.forEach(({ key, label, decimals = 18, unit = '', className = '', pointShape, pointLabel }, definitionIndex) => {
		const points = rows.flatMap((row, index) => {
			const definitionSeries = requiredArrayItem(series, definitionIndex, 'Chart definition series')
			const value = requiredArrayItem(definitionSeries, index, 'Chart series point')
			if (!Number.isFinite(value)) return []
			const timestamp = requiredArrayItem(timestamps, index, 'Chart timestamp')
			const x = margin.left + (timestampRange === 0 ? chartWidth / 2 : (chartWidth * (timestamp - minimumTimestamp)) / timestampRange)
			const y = margin.top + chartHeight - ((value - minimum) / range) * chartHeight
			return [{ x, y, row }]
		})
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
		path.setAttribute('class', `chart-line ${className}`)
		path.setAttribute('d', points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '))
		svg.append(path)
		for (const { x, y, row } of points) {
			const shape = pointShape?.(row) ?? 'circle'
			const point = document.createElementNS('http://www.w3.org/2000/svg', shape === 'diamond' ? 'rect' : 'circle')
			point.setAttribute('class', `chart-point ${className}${shape === 'diamond' ? ' initialization' : ''}`)
			if (shape === 'diamond') {
				point.setAttribute('x', String(x - 3))
				point.setAttribute('y', String(y - 3))
				point.setAttribute('width', '6')
				point.setAttribute('height', '6')
				point.setAttribute('transform', `rotate(45 ${x} ${y})`)
			} else {
				point.setAttribute('cx', String(x))
				point.setAttribute('cy', String(y))
				point.setAttribute('r', '2.8')
			}
			point.setAttribute('tabindex', '0')
			const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
			const observationType = pointLabel?.(row)
			title.textContent = `${label}: ${exactUnit(chartNumericValue(row[key]), decimals, unit, decimals)} · ${new Date(row.timestamp).toLocaleString()}${observationType ? ` · ${observationType}` : ''}`
			point.setAttribute('aria-label', title.textContent)
			point.append(title)
			svg.append(point)
		}
	})
	if (rows.length > 0)
		for (const [x, row] of [
			[margin.left, rows[0]],
			[width - margin.right, rows.at(-1)],
		] as const) {
			if (row === undefined) continue
			const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			label.setAttribute('class', 'chart-axis-label')
			label.setAttribute('x', String(x))
			label.setAttribute('y', String(height - 5))
			label.setAttribute('text-anchor', x === margin.left ? 'start' : 'end')
			label.textContent = new Date(chartTimestamp(row.timestamp)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
			svg.append(label)
		}
	return svg
}

export const chartCard = <T extends { timestamp: string }>(
	title: string,
	rows: T[],
	definitions: ChartDefinition<T>[],
	note: string,
	{
		sharedRange,
		axisUnit,
		legendItems = [],
		emptyMessage = 'No checkpoints match this view.',
	}: {
		sharedRange?: readonly [number, number]
		axisUnit?: string
		legendItems?: Array<{ label: string; className?: string }>
		emptyMessage?: string
	} = {},
) => {
	const card = element('section', 'chart-card')
	const heading = element('div', 'chart-heading')
	heading.append(element('h4', '', title))
	const legend = element('div', 'chart-legend')
	for (const { label, className = '' } of [...definitions, ...legendItems]) {
		const item = element('span')
		item.append(element('i', className === '' ? '' : `chart-${className}`), document.createTextNode(label))
		legend.append(item)
	}
	if (rows.length > 0) heading.append(legend)
	card.append(heading)
	if (rows.length === 0) card.append(element('p', 'data-note', emptyMessage))
	else {
		const independentlyScaled = definitions.length > 1 && sharedRange === undefined
		if (independentlyScaled) {
			const currentValues = element('dl', 'chart-current-values')
			for (const { key, label, decimals = 18, unit = '' } of definitions) {
				const latest = rows.findLast(row => row[key] !== undefined)
				if (latest === undefined) continue
				const item = element('div')
				item.append(element('dt', '', label), element('dd', '', exactUnit(chartNumericValue(latest[key]), decimals, unit, decimals)))
				currentValues.append(item)
			}
			card.append(currentValues)
		}
		const viewport = element('div', 'chart-scroll')
		if (independentlyScaled) {
			for (const definition of definitions) {
				const series = element('section', 'chart-series')
				series.append(element('h5', '', definition.label), lineChart(rows, [definition], { axisUnit: definition.unit }))
				viewport.append(series)
			}
		} else viewport.append(lineChart(rows, definitions, { sharedRange, axisUnit }))
		const dataDisclosure = document.createElement('details')
		dataDisclosure.className = 'chart-data-disclosure'
		dataDisclosure.append(element('summary', '', 'View exact chart data'))
		const tableViewport = element('div', 'chart-data-scroll')
		const table = document.createElement('table')
		const caption = element('caption', '', `${title} exact observations`)
		const head = document.createElement('thead')
		const headerRow = document.createElement('tr')
		headerRow.append(element('th', '', 'Time'))
		for (const definition of definitions) headerRow.append(element('th', '', definition.label))
		head.append(headerRow)
		const body = document.createElement('tbody')
		for (const row of rows) {
			const tableRow = document.createElement('tr')
			const time = element('th', '', new Date(chartTimestamp(row.timestamp)).toLocaleString())
			time.setAttribute('scope', 'row')
			tableRow.append(time)
			for (const { key, decimals = 18, unit = '' } of definitions) {
				const value = row[key]
				tableRow.append(element('td', '', value === undefined ? 'Unavailable' : exactUnit(chartNumericValue(value), decimals, unit, decimals)))
			}
			body.append(tableRow)
		}
		table.append(caption, head, body)
		tableViewport.append(table)
		dataDisclosure.append(tableViewport)
		card.append(viewport, element('p', 'data-note', `${note}${independentlyScaled ? ' Each line is independently scaled to its observed range so every trend remains visible; exact latest values are listed above.' : ''}`), dataDisclosure)
	}
	return card
}
