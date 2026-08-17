import { getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js';
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js';
import { isRepPricingEnabled, quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource } from './uniswapQuoter.js';
const OPEN_ORACLE_PRICE_PRECISION = 10n ** 30n;
function calculateOpenOraclePrice(token1Amount, token2Amount) {
    if (token1Amount <= 0n || token2Amount <= 0n)
        return undefined;
    return (token1Amount * OPEN_ORACLE_PRICE_PRECISION) / token2Amount;
}
function formatOpenOraclePriceLoadError(v4Error, v3Error) {
    const v4Detail = getErrorDetail(v4Error);
    const v3Detail = getErrorDetail(v3Error);
    const v4Message = v4Detail === undefined ? 'Uniswap V4 quote failed.' : `Uniswap V4 quote failed: ${v4Detail}.`;
    if (v3Error !== undefined) {
        const v3Message = v3Detail === undefined ? 'Uniswap V3 quote failed.' : `Uniswap V3 quote failed: ${v3Detail}`;
        return `Failed to fetch price from Uniswap. ${v4Message} ${v3Message}`;
    }
    return `Failed to fetch price from Uniswap. ${v4Message} Uniswap V3 did not run.`;
}
export async function loadOpenOracleInitialReportPriceResult(client, token1, token2, token1Amount) {
    if (!isRepPricingEnabled()) {
        const profile = getActiveNetworkProfile();
        return {
            attemptedSources: [],
            failureKind: 'unsupported-pair',
            reason: `Automatic pricing is unavailable on ${profile.displayName} because no REP pricing source is configured for this network.`,
            status: 'failure',
        };
    }
    let v4Failure = 'Uniswap V4 returned an unusable quote';
    let v4Quote;
    try {
        const { amountOut: token2Amount, source } = await quoteBestExactInputWithSource(client, token1, token2, token1Amount);
        const price = calculateOpenOraclePrice(token1Amount, token2Amount);
        if (price !== undefined) {
            v4Quote = { price, priceSource: source.protocol === 'mock' ? 'MOCK' : 'Uniswap V4', priceSourceUrl: source.poolUrl, status: 'success', token2Amount };
            if (source.protocol === 'mock')
                return v4Quote;
        }
    }
    catch (error) {
        v4Failure = error;
    }
    const attemptedSources = ['Uniswap V4', 'Uniswap V3'];
    let v3Failure = 'Uniswap V3 returned an unusable quote';
    let v3Quote;
    try {
        const { amountOut: token2Amount, source } = await quoteBestV3ExactInputWithSource(client, token1, token2, token1Amount);
        const price = calculateOpenOraclePrice(token1Amount, token2Amount);
        if (price !== undefined)
            v3Quote = { price, priceSource: source.protocol === 'mock' ? 'MOCK' : 'Uniswap V3', priceSourceUrl: source.poolUrl, status: 'success', token2Amount };
    }
    catch (error) {
        v3Failure = error;
    }
    if (v4Quote !== undefined && (v3Quote === undefined || v4Quote.token2Amount >= v3Quote.token2Amount))
        return v4Quote;
    if (v3Quote !== undefined)
        return v3Quote;
    return {
        attemptedSources,
        failureKind: 'quote-failed',
        reason: formatOpenOraclePriceLoadError(v4Failure, v3Failure),
        status: 'failure',
    };
}
export async function loadOpenOracleInitialReportPrice(client, token1, token2, token1Amount) {
    const result = await loadOpenOracleInitialReportPriceResult(client, token1, token2, token1Amount);
    if (result.status === 'failure')
        throw new Error(result.reason ?? 'Failed to fetch price from Uniswap');
    return {
        price: result.price,
        priceSource: result.priceSource,
        token2Amount: result.token2Amount,
    };
}
//# sourceMappingURL=openOraclePricing.js.map