import * as Plot from '@observablehq/plot'
import type { JsonRecord } from './api-validation.ts'
import { chartValueBounds } from './chart-values.ts'
import { utcDateTime } from './format.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

type EvidenceRow = (title: string, status: string, identity: string | undefined, block: unknown) => HTMLElement

const fraction = (value: unknown) => {
	if (!isPlainRecord(value) || typeof value['numerator'] !== 'string' || typeof value['denominator'] !== 'string' || !/^\d+$/.test(value['numerator']) || !/^\d+$/.test(value['denominator'])) return undefined
	const numerator = BigInt(value['numerator'])
	const denominator = BigInt(value['denominator'])
	if (denominator === 0n) return undefined
	return { numerator, denominator, value: Number(numerator) / Number(denominator), exact: `${numerator}/${denominator}` }
}

/** @internal Exported for exact-price regression tests. */
export const candlePrices = (candle: JsonRecord) => {
	const open = fraction(candle['open'])
	const high = fraction(candle['high'])
	const low = fraction(candle['low'])
	const close = fraction(candle['close'])
	if (!open || !high || !low || !close) return undefined
	const change = close.numerator * open.denominator - open.numerator * close.denominator
	let direction = 'flat'
	if (change < 0n) direction = 'down'
	if (change > 0n) direction = 'up'
	return { open: open.value, high: high.value, low: low.value, close: close.value, exactOpen: open.exact, exactHigh: high.exact, exactLow: low.exact, exactClose: close.exact, direction }
}

export const renderCandleContent = (candles: readonly JsonRecord[], operationRow: EvidenceRow): Element[] => {
	const plotRows = candles.flatMap(candle => {
		const start = Number(candle['bucketStart']) * 1_000
		const prices = candlePrices(candle)
		return Number.isFinite(start) && prices ? [{ start, ...prices, observations: String(candle['observations'] ?? '0') }] : []
	})
	const candleColor = (row: (typeof plotRows)[number]) => {
		if (row.direction === 'flat') return 'currentColor'
		return row.direction === 'down' ? '#e58989' : '#56d7d0'
	}
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
				Plot.ruleX(plotRows, { x: row => new Date(row.start), y1: 'low', y2: 'high', stroke: candleColor }),
				Plot.ruleY(
					plotRows.filter(row => row.open === row.close),
					{ y: 'open', x1: row => new Date(row.start - bodyHalfWidth), x2: row => new Date(row.start + bodyHalfWidth), stroke: candleColor },
				),
				Plot.rect(plotRows, { x1: row => new Date(row.start - bodyHalfWidth), x2: row => new Date(row.start + bodyHalfWidth), y1: 'open', y2: 'close', fill: candleColor, tip: true }),
			],
		})
		chart.querySelector('style')?.remove()
		chart.setAttribute('role', 'img')
		chart.setAttribute('aria-label', 'Hourly NO per YES price candles')
		chart.classList.add('time-chart')
		candleContent.push(chart)
		const disclosure = document.createElement('details')
		disclosure.className = 'chart-data-disclosure'
		const disclosureLabel = document.createElement('summary')
		disclosureLabel.textContent = 'View exact candle data'
		disclosure.append(disclosureLabel)
		for (const row of plotRows) {
			disclosure.append(operationRow(utcDateTime(row.start), `O ${row.exactOpen} · H ${row.exactHigh} · L ${row.exactLow} · C ${row.exactClose}`, `${row.observations} observations`, undefined))
		}
		candleContent.push(disclosure)
	}
	return candleContent
}
