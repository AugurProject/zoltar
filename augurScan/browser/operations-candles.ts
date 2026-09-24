import * as Plot from '@observablehq/plot'
import { isRecord, type JsonRecord } from './api-validation.ts'
import { chartValueBounds } from './chart-values.ts'

type EvidenceRow = (title: string, status: string, identity: string | undefined, block: unknown) => HTMLElement

export const renderCandleContent = (candles: readonly JsonRecord[], operationRow: EvidenceRow, operationRatio: (numerator: unknown, denominator: unknown) => string): Element[] => {
	const ratio = (value: unknown): number | undefined => {
		if (!isRecord(value) || typeof value['numerator'] !== 'string' || typeof value['denominator'] !== 'string' || !/^\d+$/.test(value['numerator']) || !/^\d+$/.test(value['denominator']) || value['denominator'] === '0') return undefined
		return Number((BigInt(value['numerator']) * 1_000_000_000n) / BigInt(value['denominator'])) / 1_000_000_000
	}
	const plotRows = candles.flatMap(candle => {
		const start = Number(candle['bucketStart']) * 1_000
		const open = ratio(candle['open'])
		const high = ratio(candle['high'])
		const low = ratio(candle['low'])
		const close = ratio(candle['close'])
		return Number.isFinite(start) && open !== undefined && high !== undefined && low !== undefined && close !== undefined ? [{ start, open, high, low, close, direction: close >= open ? 'up' : 'down' }] : []
	})
	const orderedStarts = plotRows.map(row => row.start).toSorted((left, right) => left - right)
	const minimumGap = orderedStarts.reduce<number | undefined>((smallest, start, index) => {
		const previous = orderedStarts[index - 1]
		const gap = previous === undefined ? 0 : start - previous
		return gap > 0 ? Math.min(smallest ?? gap, gap) : smallest
	}, undefined)
	const bodyHalfWidth = minimumGap === undefined ? 120_000 : Math.min(1_200_000, Math.max(1_000, minimumGap * 0.3))
	const domainPadding = minimumGap ?? 1_800_000
	const candleContent: Element[] = []
	if (plotRows.length > 0) {
		const bounds = chartValueBounds(
			plotRows.flatMap(row => [row.low, row.high]),
			undefined,
		)
		const chart = Plot.plot({
			width: Math.min(760, Math.max(280, window.innerWidth - 96)),
			height: 280,
			marginLeft: 60,
			marginBottom: 36,
			style: { background: 'transparent', color: '#a9bdc8', fontSize: '12px' },
			x: { type: 'utc', ticks: 5, label: null, domain: [new Date((orderedStarts[0] ?? 0) - domainPadding), new Date((orderedStarts.at(-1) ?? 0) + domainPadding)] },
			y: { grid: true, label: 'NO per YES', domain: [bounds.minimum, bounds.maximum] },
			marks: [
				Plot.ruleX(plotRows, { x: row => new Date(row.start), y1: 'low', y2: 'high', stroke: row => (row.direction === 'up' ? '#56d7d0' : '#e58989') }),
				Plot.rect(plotRows, { x1: row => new Date(row.start - bodyHalfWidth), x2: row => new Date(row.start + bodyHalfWidth), y1: 'open', y2: 'close', fill: row => (row.direction === 'up' ? '#56d7d0' : '#e58989'), tip: true }),
			],
		})
		chart.setAttribute('role', 'img')
		chart.setAttribute('aria-label', 'Hourly NO per YES price candles')
		chart.classList.add('time-chart')
		candleContent.push(chart)
		const disclosure = document.createElement('details')
		disclosure.className = 'chart-data-disclosure'
		const disclosureLabel = document.createElement('summary')
		disclosureLabel.textContent = 'View exact candle data'
		disclosure.append(disclosureLabel)
		for (const candle of candles) {
			const open = isRecord(candle['open']) ? candle['open'] : {}
			const high = isRecord(candle['high']) ? candle['high'] : {}
			const low = isRecord(candle['low']) ? candle['low'] : {}
			const close = isRecord(candle['close']) ? candle['close'] : {}
			disclosure.append(
				operationRow(
					new Date(Number(candle['bucketStart'] ?? 0) * 1_000).toLocaleString(),
					`O ${operationRatio(open['numerator'], open['denominator'])} · H ${operationRatio(high['numerator'], high['denominator'])} · L ${operationRatio(low['numerator'], low['denominator'])} · C ${operationRatio(close['numerator'], close['denominator'])}`,
					`${String(candle['observations'] ?? '0')} observations`,
					undefined,
				),
			)
		}
		candleContent.push(disclosure)
	}
	return candleContent
}
