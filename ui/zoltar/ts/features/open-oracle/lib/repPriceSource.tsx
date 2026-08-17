import * as commonCopy from '../../../copy/common.js'
import * as pricingCopy from '../../../copy/pricing.js'
import { assertNever } from '../../../lib/assert.js'

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
				badgeLabel: pricingCopy.mock,
				linkTitle: pricingCopy.priceFromTheSimulationMock,
				quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtSimulationPrice,
				quotedRepPerEthLabel: pricingCopy.simulationRepEth,
				tooltip: pricingCopy.simulationPriceSourceDetail,
			}
		case 'v4':
			return {
				badgeLabel: pricingCopy.uniswapV4BadgeLabel,
				linkTitle: pricingCopy.priceFromUniswapV4,
				quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtUniswapV4Price,
				quotedRepPerEthLabel: pricingCopy.uniswapV4RepEth,
				tooltip: pricingCopy.uniswapV4PriceSourceDetail,
			}
		case 'v3':
			return {
				badgeLabel: pricingCopy.uniswapV3BadgeLabel,
				linkTitle: pricingCopy.priceFromUniswapV3,
				quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtUniswapV3Price,
				quotedRepPerEthLabel: pricingCopy.uniswapV3RepEth,
				tooltip: pricingCopy.uniswapV3PriceSourceDetail,
			}
		case undefined:
			return {
				badgeLabel: undefined,
				linkTitle: undefined,
				quotedCollateralizationLabel: pricingCopy.targetCollateralization,
				quotedRepPerEthLabel: commonCopy.repPerEth,
				tooltip: pricingCopy.repPriceUnavailableDetail,
			}
		default:
			return assertNever(source)
	}
}

export function renderRepPriceSourceLabel(source: RepPriceSource | undefined, sourceUrl: string | undefined) {
	const copy = getRepPriceSourceCopy(source)
	if (copy.badgeLabel === undefined) return undefined
	if (sourceUrl === undefined || copy.linkTitle === undefined) return pricingCopy.formatWrappedValue(copy.badgeLabel)
	return (
		<a href={sourceUrl} title={copy.linkTitle} target='_blank' rel='noreferrer'>
			{pricingCopy.formatWrappedValue(copy.badgeLabel)}
		</a>
	)
}
