import { assertNever } from './assert.js'

export type RepPriceSource = 'v4' | 'v3' | 'mock'

function getRepPriceSourceBadgeLabel(source: RepPriceSource) {
	switch (source) {
		case 'mock':
			return 'MOCK'
		case 'v4':
			return 'u4'
		case 'v3':
			return 'u3'
		default:
			return assertNever(source)
	}
}

function getRepPriceSourceLinkTitle(source: RepPriceSource, mockSourceTitle: string) {
	switch (source) {
		case 'mock':
			return mockSourceTitle
		case 'v4':
			return 'Price from Uniswap V4'
		case 'v3':
			return 'Price from Uniswap V3'
		default:
			return assertNever(source)
	}
}

export function getRepPriceTooltip(source: RepPriceSource | undefined) {
	switch (source) {
		case 'mock':
			return 'Uses the simulation REP/ETH mock price.'
		case 'v4':
			return 'Uses the live Uniswap V4 REP/ETH quote.'
		case 'v3':
			return 'Uses the live Uniswap V3 REP/ETH quote.'
		case undefined:
			return 'REP/ETH price source is unavailable until a quote loads.'
		default:
			return assertNever(source)
	}
}

export function renderRepPriceSourceLabel(source: RepPriceSource, sourceUrl: string | undefined, mockSourceTitle = 'Price from the simulation REP/ETH mock') {
	const label = getRepPriceSourceBadgeLabel(source)
	if (sourceUrl === undefined) return `(${label})`
	return (
		<a href={sourceUrl} title={getRepPriceSourceLinkTitle(source, mockSourceTitle)} target='_blank' rel='noreferrer'>
			{`(${label})`}
		</a>
	)
}
