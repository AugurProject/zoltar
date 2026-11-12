import { formatAmountDisplay } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '../../../copy/portfolioPrice.js'

const PLAUSIBLE_FACTOR = 2n

type PortfolioPriceDeviation = 'inverted' | 'above' | 'below'

const isWithinFactor = (value: bigint, target: bigint) => value <= target * PLAUSIBLE_FACTOR && value * PLAUSIBLE_FACTOR >= target

/**
 * @internal Exported for unit tests; the UI reads the warning from `getPortfolioPriceWarning`.
 * Compares a proposed price with a reference price, both at the supplied decimal precision. Prices within 2× of the reference are plausible.
 */
export function getPortfolioPriceDeviation(price: bigint | undefined, referencePrice: bigint | undefined, priceDecimals = 18): PortfolioPriceDeviation | undefined {
	if (price === undefined || referencePrice === undefined || price <= 0n || referencePrice <= 0n) return undefined
	if (isWithinFactor(price, referencePrice)) return undefined
	if (isWithinFactor(price * referencePrice, 10n ** BigInt(2 * priceDecimals))) return 'inverted'
	return price > referencePrice ? 'above' : 'below'
}

export function getPortfolioPriceWarning(price: bigint | undefined, referencePrice: bigint | undefined, collateral: { symbol: string; decimals: number }) {
	const priceDecimals = 36 - collateral.decimals
	const deviation = getPortfolioPriceDeviation(price, referencePrice, priceDecimals)
	if (deviation === undefined || referencePrice === undefined) return undefined
	const reference = formatAmountDisplay(referencePrice, { units: priceDecimals })
	if (deviation === 'inverted') return copy.formatInvertedPriceWarning(reference, collateral.symbol)
	return deviation === 'above' ? copy.formatPriceAboveReferenceWarning(reference, collateral.symbol) : copy.formatPriceBelowReferenceWarning(reference, collateral.symbol)
}
