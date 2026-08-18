import { formatUnits } from '@zoltar/shared/ethereum';
const PRICE_PRECISION = 1000000000000000000n;
const PRICE_PRECISION_AS_NUMBER = 1e18;
const SECONDS_PER_YEAR = 31_536_000;
// Matches SecurityPoolUtils.calculateRetentionRate(0, 0), the on-chain
// initial retention for public origin-pool deployments.
export const ORIGIN_POOL_INITIAL_RETENTION_RATE = 999999996848000000n;
function formatPercent(value) {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}%`;
}
export function formatOpenInterestFeePerYearPercent(retentionRate) {
    if (retentionRate === undefined)
        return '—';
    if (retentionRate <= 0n)
        return '100%';
    const retentionRateAsNumber = Number.parseFloat(formatUnits(retentionRate, 18));
    if (!Number.isFinite(retentionRateAsNumber) || retentionRateAsNumber <= 0)
        return '100%';
    const annualRetention = Math.pow(retentionRateAsNumber, SECONDS_PER_YEAR);
    const annualFeePercent = Math.max(0, Math.min(100, (1 - annualRetention) * 100));
    return formatPercent(annualFeePercent);
}
export function openInterestFeePerYearBigint(retentionRate) {
    if (retentionRate === undefined)
        return undefined;
    if (retentionRate <= 0n)
        return 100n * PRICE_PRECISION;
    const retentionRateAsNumber = Number.parseFloat(formatUnits(retentionRate, 18));
    if (!Number.isFinite(retentionRateAsNumber) || retentionRateAsNumber <= 0)
        return 100n * PRICE_PRECISION;
    const annualRetention = Math.pow(retentionRateAsNumber, SECONDS_PER_YEAR);
    const annualFeePercent = Math.max(0, Math.min(100, (1 - annualRetention) * 100));
    return BigInt(Math.round(annualFeePercent * PRICE_PRECISION_AS_NUMBER));
}
//# sourceMappingURL=retentionRate.js.map