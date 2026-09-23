import * as Plot from '@observablehq/plot'
import type { ChartDefinition, ProtocolAddressLinkOptions } from './browser-types.ts'
import { exactUnit } from './format.ts'

export const createStateComponents = (element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K], protocolAddressLink: (address: string | null, options?: ProtocolAddressLinkOptions) => HTMLAnchorElement) => {
	const compactValue = (value: string | number | bigint | null | undefined, decimals = 18): number => {
		if (value === null || value === undefined) return 0
		const digits = String(value)
		const scale = 10 ** Math.min(decimals, 18)
		return Number(digits) / scale
	}

	const staticField = (label: string, value: string | number | bigint | null | undefined) => {
		const field = element('div', 'static-field')
		field.append(element('span', '', label), element('code', '', value === null || value === undefined ? '—' : String(value)))
		return field
	}

	const staticAddressField = (label: string, address: string | null | undefined, chainId: string) => {
		const field = element('div', 'static-field')
		field.append(element('span', '', label), address ? protocolAddressLink(address, { chainId }) : element('code', '', '—'))
		return field
	}

	const metricCard = (label: string, value: string, detail?: string) => {
		const card = element('div', 'metric-card')
		card.append(element('span', '', label), element('strong', '', value))
		if (detail !== undefined) card.append(element('small', '', detail))
		return card
	}

	const chartNumericValue = (value: unknown): string | number | bigint | null | undefined => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value === null || value === undefined ? value : undefined)

	const chartTimestamp = (value: string): number => {
		const parsed = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value)
		return Number.isFinite(parsed) ? parsed : 0
	}

	const lineChart = <T extends { timestamp: string }>(rows: T[], definitions: ChartDefinition<T>[], { sharedRange, axisUnit = '' }: { sharedRange?: readonly [number, number]; axisUnit?: string } = {}) => {
		const series = definitions.flatMap((definition, index) =>
			rows.flatMap(row => {
				const raw = row[definition.key]
				if (raw === undefined) return []
				const value = compactValue(chartNumericValue(raw), definition.decimals ?? 18)
				const timestamp = chartTimestamp(row.timestamp)
				return Number.isFinite(value) && timestamp > 0 ? [{ timestamp: new Date(timestamp), value, name: definition.label, color: index === 0 ? '#56d7d0' : '#f0b35d' }] : []
			}),
		)
		const chart = Plot.plot({
			width: 760,
			height: 220,
			marginLeft: 58,
			marginBottom: 36,
			style: { background: 'transparent', color: '#a9bdc8' },
			x: { type: 'utc', label: null, ticks: 5 },
			y: { label: axisUnit || null, grid: true, ...(sharedRange === undefined ? {} : { domain: sharedRange }) },
			color: { legend: definitions.length > 1 },
			marks: [Plot.lineY(series, { x: 'timestamp', y: 'value', stroke: 'name', tip: true }), Plot.dot(series, { x: 'timestamp', y: 'value', stroke: 'name', r: 2 })],
		})
		chart.setAttribute('role', 'img')
		chart.setAttribute('aria-label', `${definitions.map(definition => definition.label).join(', ')} over time`)
		chart.classList.add('time-chart')
		return chart
	}

	const chartCard = <T extends { timestamp: string }>(
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
					item.append(element('dt', '', label), element('dd', '', exactUnit(chartNumericValue(latest[key]), decimals, unit)))
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
					tableRow.append(element('td', '', value === undefined ? 'Unavailable' : exactUnit(chartNumericValue(value), decimals, unit)))
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

	const stateHeader = (eyebrow: string, title: string, subtitle: string, kind: string) => {
		const header = element('header', 'state-detail-header')
		const copy = element('div')
		copy.append(element('p', 'eyebrow', eyebrow), element('h3', 'state-detail-title', title), element('p', 'state-detail-subtitle', subtitle))
		header.append(copy, element('span', 'state-kind', kind))
		return header
	}

	return { staticField, staticAddressField, metricCard, chartNumericValue, chartCard, stateHeader }
}
