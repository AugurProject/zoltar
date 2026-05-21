import { assertNever } from './assert.js'

export type RepPriceSource = 'v4' | 'v3' | 'mock'

type RepPriceSourceCopy = {
	badgeLabel: string | undefined
	linkTitle: string | undefined
	quotedCollateralizationLabel: string
	quotedRepPerEthLabel: string
	tooltip: string
}

export function getRepPriceSourceCopy(source: RepPriceSource | undefined): RepPriceSourceCopy {
	switch (source) {
		case 'mock':
			return {
				badgeLabel: 'MOCK',
				linkTitle: 'Price from the simulation mock',
				quotedCollateralizationLabel: 'Target Collateralization @ Simulation Price',
				quotedRepPerEthLabel: 'Simulation REP / ETH',
				tooltip: 'Uses the simulation REP/ETH mock price.',
			}
		case 'v4':
			return {
				badgeLabel: 'u4',
				linkTitle: 'Price from Uniswap V4',
				quotedCollateralizationLabel: 'Target Collateralization @ Uniswap V4 Price',
				quotedRepPerEthLabel: 'Uniswap V4 REP / ETH',
				tooltip: 'Uses the live Uniswap V4 REP/ETH quote.',
			}
		case 'v3':
			return {
				badgeLabel: 'u3',
				linkTitle: 'Price from Uniswap V3',
				quotedCollateralizationLabel: 'Target Collateralization @ Uniswap V3 Price',
				quotedRepPerEthLabel: 'Uniswap V3 REP / ETH',
				tooltip: 'Uses the live Uniswap V3 REP/ETH quote.',
			}
		case undefined:
			return {
				badgeLabel: undefined,
				linkTitle: undefined,
				quotedCollateralizationLabel: 'Target Collateralization',
				quotedRepPerEthLabel: 'REP / ETH',
				tooltip: 'REP/ETH price source is unavailable until a quote loads.',
			}
		default:
			return assertNever(source)
	}
}

export function renderRepPriceSourceLabel(source: RepPriceSource | undefined, sourceUrl: string | undefined) {
	const copy = getRepPriceSourceCopy(source)
	if (copy.badgeLabel === undefined) return undefined
	if (sourceUrl === undefined || copy.linkTitle === undefined) return `(${copy.badgeLabel})`
	return (
		<a href={sourceUrl} title={copy.linkTitle} target='_blank' rel='noreferrer'>
			{`(${copy.badgeLabel})`}
		</a>
	)
}
