import { formatAmountDisplay } from '@zoltar/ui-core-shared/lib/formatters.js'

/** Shared token display policy; transaction limits and inputs use the exact or truncating helpers. */
export function formatRoundedUnits(value: bigint, decimals = 18, maximumFractionDigits = 2) {
	return formatAmountDisplay(value, { units: decimals, decimals: maximumFractionDigits })
}

/** Formats two ETH amounts as `first / second ETH`, e.g. minted against maximum capacity or total against fee-eligible limits. Both round the same way, so their order is preserved. */
export function formatEthAmountPair(firstAttoEth: bigint, secondAttoEth: bigint, asset = { decimals: 18, symbol: 'ETH' }) {
	return `${formatRoundedUnits(firstAttoEth, asset.decimals)} / ${formatRoundedUnits(secondAttoEth, asset.decimals)} ${asset.symbol}`
}

/** Closes a message with a period unless it already ends a sentence, so composed errors and reasons read as prose. */
export { ensureSentence as endSentence } from '@zoltar/ui-core-shared/lib/errors.js'
