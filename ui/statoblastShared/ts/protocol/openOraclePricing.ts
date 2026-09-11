import { getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { isRepPricingEnabled, quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteExactInput } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'

const OPEN_ORACLE_PRICE_PRECISION = 10n ** 30n

type OpenOracleInitialReportPriceSource = 'Uniswap V4' | 'Uniswap V3' | 'MOCK' | 'Manual override' | 'Unavailable'
type OpenOracleInitialReportQuoteSource = Exclude<OpenOracleInitialReportPriceSource, 'Manual override' | 'Unavailable'>
type OpenOracleInitialReportQuote = {
	price: bigint
	priceSource: OpenOracleInitialReportQuoteSource
	token2Amount: bigint
}

function calculateOpenOraclePrice(token1Amount: bigint, token2Amount: bigint) {
	if (token1Amount <= 0n || token2Amount <= 0n) return undefined
	return (token1Amount * OPEN_ORACLE_PRICE_PRECISION) / token2Amount
}

function formatOpenOraclePriceLoadError(v4Error: unknown, v3Error?: unknown) {
	const v4Detail = getErrorDetail(v4Error)
	const v3Detail = getErrorDetail(v3Error)
	const v4Message = v4Detail === undefined ? 'Uniswap V4 quote failed.' : `Uniswap V4 quote failed: ${v4Detail}.`
	if (v3Error !== undefined) {
		const v3Message = v3Detail === undefined ? 'Uniswap V3 quote failed.' : `Uniswap V3 quote failed: ${v3Detail}`
		return `Failed to fetch price from Uniswap. ${v4Message} ${v3Message}`
	}
	return `Failed to fetch price from Uniswap. ${v4Message} Uniswap V3 did not run.`
}

export async function loadOpenOracleInitialReportPrice(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<OpenOracleInitialReportQuote> {
	if (!isRepPricingEnabled()) {
		const profile = getActiveNetworkProfile()
		throw new Error(`Automatic pricing is unavailable on ${profile.displayName} because no REP pricing source is configured for this network.`)
	}
	let v4Failure: unknown = 'Uniswap V4 returned an unusable quote'
	let v4Quote: OpenOracleInitialReportQuote | undefined
	try {
		const { amountOut: token2Amount, source } = await quoteBestExactInputWithSource(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) {
			v4Quote = { price, priceSource: source.protocol === 'mock' ? 'MOCK' : 'Uniswap V4', token2Amount }
			if (source.protocol === 'mock') return v4Quote
		}
	} catch (error) {
		v4Failure = error
	}
	let v3Failure: unknown = 'Uniswap V3 returned an unusable quote'
	let v3Quote: OpenOracleInitialReportQuote | undefined
	try {
		const { amountOut: token2Amount, source } = await quoteBestV3ExactInputWithSource(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) v3Quote = { price, priceSource: source.protocol === 'mock' ? 'MOCK' : 'Uniswap V3', token2Amount }
	} catch (error) {
		v3Failure = error
	}

	if (v4Quote !== undefined && (v3Quote === undefined || v4Quote.token2Amount >= v3Quote.token2Amount)) return v4Quote
	if (v3Quote !== undefined) return v3Quote
	throw new Error(formatOpenOraclePriceLoadError(v4Failure, v3Failure))
}
