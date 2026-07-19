import { getErrorDetail } from '../lib/errors.js'
import { isRepPricingEnabled, quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteExactInput } from './uniswapQuoter.js'

const OPEN_ORACLE_PRICE_PRECISION = 10n ** 30n

type OpenOracleInitialReportPriceSource = 'Uniswap V4' | 'Uniswap V3' | 'MOCK' | 'Manual override' | 'Unavailable'
export type OpenOracleInitialReportQuoteSource = Exclude<OpenOracleInitialReportPriceSource, 'Manual override' | 'Unavailable'>
type OpenOracleInitialReportQuoteFailureKind = 'unsupported-pair' | 'quote-failed'
export type OpenOracleInitialReportPriceLoadResult =
	| {
			status: 'success'
			price: bigint
			priceSource: OpenOracleInitialReportQuoteSource
			priceSourceUrl: string | undefined
			token2Amount: bigint
	  }
	| {
			attemptedSources: OpenOracleInitialReportQuoteSource[]
			failureKind: OpenOracleInitialReportQuoteFailureKind
			reason: string | undefined
			status: 'failure'
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

export async function loadOpenOracleInitialReportPriceResult(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<OpenOracleInitialReportPriceLoadResult> {
	if (!isRepPricingEnabled())
		return {
			attemptedSources: [],
			failureKind: 'unsupported-pair',
			reason: 'Automatic pricing is unavailable for this pair in simulation mode. The simulation mock only supports REP / ETH and REP / WETH pairs.',
			status: 'failure',
		}
	let v4Failure: unknown = 'Uniswap V4 returned an unusable quote'
	try {
		const { amountOut: token2Amount, source } = await quoteBestExactInputWithSource(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) return { price, priceSource: source.protocol === 'mock' ? 'MOCK' : 'Uniswap V4', priceSourceUrl: source.poolUrl, status: 'success', token2Amount }
	} catch (error) {
		v4Failure = error
	}
	const attemptedSources: OpenOracleInitialReportQuoteSource[] = ['Uniswap V4', 'Uniswap V3']
	try {
		const { amountOut: token2Amount, source } = await quoteBestV3ExactInputWithSource(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) return { price, priceSource: source.protocol === 'mock' ? 'MOCK' : 'Uniswap V3', priceSourceUrl: source.poolUrl, status: 'success', token2Amount }
		return {
			attemptedSources,
			failureKind: 'quote-failed',
			reason: formatOpenOraclePriceLoadError(v4Failure, 'Uniswap V3 returned an unusable quote'),
			status: 'failure',
		}
	} catch (v3Error) {
		return {
			attemptedSources,
			failureKind: 'quote-failed',
			reason: formatOpenOraclePriceLoadError(v4Failure, v3Error),
			status: 'failure',
		}
	}
}

export async function loadOpenOracleInitialReportPrice(
	client: Parameters<typeof quoteExactInput>[0],
	token1: Parameters<typeof quoteExactInput>[1],
	token2: Parameters<typeof quoteExactInput>[2],
	token1Amount: bigint,
): Promise<{
	price: bigint
	priceSource: OpenOracleInitialReportQuoteSource
	token2Amount: bigint
}> {
	const result = await loadOpenOracleInitialReportPriceResult(client, token1, token2, token1Amount)
	if (result.status === 'failure') throw new Error(result.reason ?? 'Failed to fetch price from Uniswap')
	return {
		price: result.price,
		priceSource: result.priceSource,
		token2Amount: result.token2Amount,
	}
}
