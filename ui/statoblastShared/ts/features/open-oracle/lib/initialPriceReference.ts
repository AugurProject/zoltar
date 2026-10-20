import { formatOpenOraclePriceInput } from './openOracle.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'

const PRICE_PRECISION = 10n ** 18n
// A REP per ETH price entered as ETH per REP multiplies with the reference to about 1 at 18-decimal precision.
const INVERTED_PRODUCT = PRICE_PRECISION * PRICE_PRECISION
const PLAUSIBLE_FACTOR = 2n

type InitialPriceDeviation = 'inverted' | 'above' | 'below'

const isWithinFactor = (value: bigint, target: bigint) => value <= target * PLAUSIBLE_FACTOR && value * PLAUSIBLE_FACTOR >= target

/**
 * @internal Exported for unit tests; the UI reads the warning from `getInitialPriceWarning`.
 * Compares a proposed REP per ETH price with a reference price, both with 18 decimals. Prices within 2× of the reference are plausible.
 */
export function getInitialPriceDeviation(price: bigint | undefined, referencePrice: bigint | undefined): InitialPriceDeviation | undefined {
	if (price === undefined || referencePrice === undefined || price <= 0n || referencePrice <= 0n) return undefined
	if (isWithinFactor(price, referencePrice)) return undefined
	if (isWithinFactor(price * referencePrice, INVERTED_PRODUCT)) return 'inverted'
	return price > referencePrice ? 'above' : 'below'
}

export function getInitialPriceWarning(price: bigint | undefined, referencePrice: bigint | undefined) {
	const deviation = getInitialPriceDeviation(price, referencePrice)
	if (deviation === undefined || referencePrice === undefined) return undefined
	const reference = formatOpenOraclePriceInput(referencePrice, 18)
	if (deviation === 'inverted') return priceRequestCopy.formatInvertedPriceWarning(reference)
	return deviation === 'above' ? priceRequestCopy.formatPriceAboveReferenceWarning(reference) : priceRequestCopy.formatPriceBelowReferenceWarning(reference)
}
