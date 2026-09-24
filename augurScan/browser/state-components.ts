import * as Plot from '@observablehq/plot'
import type { ChartDefinition, ProtocolAddressLinkOptions } from './browser-types.ts'
import { chartTokenValue, chartValueBounds } from './chart-values.ts'
import { exactUnit } from './format.ts'

export const createStateComponents = (element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K], protocolAddressLink: (address: string | null, options?: ProtocolAddressLinkOptions) => HTMLAnchorElement) => {
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
	const hasChartValue = (value: unknown): boolean => {
		const numeric = chartNumericValue(value)
		return numeric !== undefined && numeric !== null && String(numeric).trim() !== '' && Number.isFinite(Number(numeric))
	}

	const lineChart = <T extends { timestamp: string }>(rows: T[], definitions: ChartDefinition<T>[], { sharedRange, axisUnit = '', zeroBaseline = false }: { sharedRange?: readonly [number, number]; axisUnit?: string; zeroBaseline?: boolean } = {}) => {
		const series = definitions.flatMap((definition, index) =>
			rows.flatMap(row => {
				const raw = row[definition.key]
				if (!hasChartValue(raw)) return []
				const value = chartTokenValue(chartNumericValue(raw), definition.decimals ?? 18)
				const timestamp = chartTimestamp(row.timestamp)
				return Number.isFinite(value) && timestamp > 0 ? [{ timestamp: new Date(timestamp), value, name: definition.label, color: index === 0 ? '#56d7d0' : '#f0b35d' }] : []
			}),
		)
		const bounds = chartValueBounds(
			series.map(point => point.value),
			sharedRange,
			zeroBaseline,
		)
		const chart = Plot.plot({
			width: 760,
			height: 220,
			marginLeft: 90,
			marginBottom: 36,
			style: { background: 'transparent', color: '#a9bdc8' },
			x: { type: 'utc', label: null, ticks: 5 },
			y: { label: axisUnit || null, tickFormat: '.12~g', grid: true, domain: [bounds.minimum, bounds.maximum] },
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
			zeroBaseline = false,
			legendItems = [],
			emptyMessage = 'No checkpoints match this view.',
		}: {
			sharedRange?: readonly [number, number]
			axisUnit?: string
			zeroBaseline?: boolean
			legendItems?: Array<{ label: string; className?: string }>
			emptyMessage?: string
		} = {},
	) => {
		const availableDefinitions = definitions.filter(definition => rows.some(row => hasChartValue(row[definition.key]) && chartTimestamp(row.timestamp) > 0))
		const missingDefinitions = definitions.filter(definition => !availableDefinitions.includes(definition))
		const card = element('section', 'chart-card')
		const heading = element('div', 'chart-heading')
		heading.append(element('h4', '', title))
		const legend = element('div', 'chart-legend')
		for (const { label, className = '' } of [...definitions, ...legendItems]) {
			const item = element('span')
			item.append(element('i', className === '' ? '' : `chart-${className}`), document.createTextNode(label))
			legend.append(item)
		}
		if (availableDefinitions.length > 0) heading.append(legend)
		card.append(heading)
		if (rows.length === 0) card.append(element('p', 'data-note', emptyMessage))
		else if (availableDefinitions.length === 0) card.append(element('p', 'data-note', 'Chart values are unavailable in these checkpoints.'))
		else {
			if (missingDefinitions.length > 0) card.append(element('p', 'data-note', `Unavailable series: ${missingDefinitions.map(definition => definition.label).join(', ')}.`))
			const independentlyScaled = definitions.length > 1 && sharedRange === undefined
			const currentValues = element('dl', 'chart-current-values')
			for (const { key, label, decimals = 18, unit = '' } of availableDefinitions) {
				const latest = rows.findLast(row => hasChartValue(row[key]))
				if (latest === undefined) continue
				const item = element('div')
				item.append(element('dt', '', label), element('dd', '', exactUnit(chartNumericValue(latest[key]), decimals, unit)))
				currentValues.append(item)
			}
			card.append(currentValues)
			const viewport = element('div', 'chart-scroll')
			if (independentlyScaled) {
				for (const definition of availableDefinitions) {
					const series = element('section', 'chart-series')
					series.append(element('h5', '', definition.label), lineChart(rows, [definition], { axisUnit: definition.unit, zeroBaseline }))
					viewport.append(series)
				}
			} else viewport.append(lineChart(rows, availableDefinitions, { sharedRange, zeroBaseline, axisUnit: axisUnit ?? (new Set(availableDefinitions.map(definition => definition.unit)).size === 1 ? availableDefinitions[0]?.unit : undefined) }))
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
					tableRow.append(element('td', '', hasChartValue(value) ? exactUnit(chartNumericValue(value), decimals, unit) : 'Unavailable'))
				}
				body.append(tableRow)
			}
			table.append(caption, head, body)
			tableViewport.append(table)
			dataDisclosure.append(tableViewport)
			card.append(viewport, element('p', 'data-note', `${note}${zeroBaseline ? ' Amount axes start at zero and expand to the observed maximum.' : ''}${independentlyScaled ? ' Each line uses its own scale; exact latest values are listed above.' : ''}`), dataDisclosure)
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
