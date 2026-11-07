import { formatAmountDisplay } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '../../../copy/portfolioPrice.js'

const PRICE_PRECISION = 10n ** 18n
// A REP per ETH price entered as ETH per REP multiplies with the reference to about 1 at 18-decimal precision.
const INVERTED_PRODUCT = PRICE_PRECISION * PRICE_PRECISION
const PLAUSIBLE_FACTOR = 2n

type PortfolioPriceDeviation = 'inverted' | 'above' | 'below'

const isWithinFactor = (value: bigint, target: bigint) => value <= target * PLAUSIBLE_FACTOR && value * PLAUSIBLE_FACTOR >= target

/**
 * @internal Exported for unit tests; the UI reads the warning from `getPortfolioPriceWarning`.
 * Compares a proposed REP per ETH price with a reference price, both with 18 decimals. Prices within 2× of the reference are plausible.
 */
export function getPortfolioPriceDeviation(price: bigint | undefined, referencePrice: bigint | undefined): PortfolioPriceDeviation | undefined {
	if (price === undefined || referencePrice === undefined || price <= 0n || referencePrice <= 0n) return undefined
	if (isWithinFactor(price, referencePrice)) return undefined
	if (isWithinFactor(price * referencePrice, INVERTED_PRODUCT)) return 'inverted'
	return price > referencePrice ? 'above' : 'below'
}

export function getPortfolioPriceWarning(price: bigint | undefined, referencePrice: bigint | undefined) {
	const deviation = getPortfolioPriceDeviation(price, referencePrice)
	if (deviation === undefined || referencePrice === undefined) return undefined
	const reference = formatAmountDisplay(referencePrice)
	if (deviation === 'inverted') return copy.formatInvertedPriceWarning(reference)
	return deviation === 'above' ? copy.formatPriceAboveReferenceWarning(reference) : copy.formatPriceBelowReferenceWarning(reference)
}
