import { bigintToSafeNumber, formatEther, formatUnits } from '@zoltar/shared/ethereum';
const MILLISECONDS_PER_SECOND = 1000;
const MAX_DATE_TIMESTAMP_SECONDS = 8640000000000n;
const SECONDS_PER_MINUTE = 60n;
const SECONDS_PER_HOUR = 60n * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR;
const SI_SUFFIXES = ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
function formatGroupedInteger(value) {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function formatDecimalString(value) {
    const isNegative = value.startsWith('-');
    const unsignedValue = isNegative ? value.slice(1) : value;
    const [integerPart = '0', fractionalPart] = unsignedValue.split('.');
    const formattedIntegerPart = formatGroupedInteger(BigInt(integerPart));
    return `${isNegative ? '-' : ''}${formattedIntegerPart}${fractionalPart === undefined ? '' : `.${fractionalPart}`}`;
}
function assertInteger(value, label) {
    if (!Number.isInteger(value))
        throw new RangeError(`${label} must be an integer`);
}
function assertNonNegativeInteger(value, label) {
    assertInteger(value, label);
    if (value < 0)
        throw new RangeError(`${label} must be non-negative`);
}
function formatTrimmedDecimal(integerPart, fractionalPart, decimals) {
    if (decimals === 0 || fractionalPart === 0n)
        return integerPart.toString();
    return `${integerPart}.${fractionalPart.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}
function formatRoundedScaledValue(value, divisor, decimals) {
    const scale = 10n ** BigInt(decimals);
    const rounded = (value * scale + divisor / 2n) / divisor;
    const integerPart = rounded / scale;
    const fractionalPart = rounded % scale;
    return {
        integerPart,
        text: formatTrimmedDecimal(integerPart, fractionalPart, decimals),
    };
}
function formatScientificCurrencyBalance(value, units, decimals) {
    const isNegative = value < 0n;
    const absoluteValue = isNegative ? -value : value;
    const unitBase = 10n ** BigInt(units);
    const wholeUnits = absoluteValue / unitBase;
    let exponent = wholeUnits.toString().length - 1;
    while (true) {
        const divisor = 10n ** BigInt(exponent) * unitBase;
        const rounded = formatRoundedScaledValue(absoluteValue, divisor, decimals);
        if (rounded.integerPart < 10n)
            return `${isNegative ? '-' : ''}${rounded.text}E${exponent}`;
        exponent += 1;
    }
}
function formatTimestampPart(value) {
    return value.toString().padStart(2, '0');
}
function formatUtcTimestamp(timestamp) {
    if (timestamp < -MAX_DATE_TIMESTAMP_SECONDS || timestamp > MAX_DATE_TIMESTAMP_SECONDS)
        return undefined;
    const date = new Date(bigintToSafeNumber(timestamp * BigInt(MILLISECONDS_PER_SECOND), 'Timestamp'));
    if (Number.isNaN(date.getTime()))
        return undefined;
    return `${date.getUTCFullYear()}-${formatTimestampPart(date.getUTCMonth() + 1)}-${formatTimestampPart(date.getUTCDate())} ${formatTimestampPart(date.getUTCHours())}:${formatTimestampPart(date.getUTCMinutes())}:${formatTimestampPart(date.getUTCSeconds())} UTC`;
}
export function formatTimestampDateTime(timestamp) {
    if (timestamp < -MAX_DATE_TIMESTAMP_SECONDS || timestamp > MAX_DATE_TIMESTAMP_SECONDS)
        return undefined;
    const date = new Date(bigintToSafeNumber(timestamp * BigInt(MILLISECONDS_PER_SECOND), 'Timestamp'));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function getEffectiveRoundedDecimals(absoluteValue, units, decimals) {
    if (absoluteValue === 0n)
        return decimals;
    const base = 10n ** BigInt(units);
    if (absoluteValue >= base)
        return decimals;
    const leadingFractionalZeroCount = units - absoluteValue.toString().length;
    return Math.max(decimals, leadingFractionalZeroCount + 2);
}
export function formatCurrencyBalance(value, units = 18) {
    if (value === undefined)
        return '—';
    assertInteger(units, 'Units');
    const formattedValue = units === 18 ? formatEther(value) : formatUnits(value, units);
    return formatDecimalString(formattedValue);
}
export function formatCurrencyInputBalance(value, units = 18) {
    assertInteger(units, 'Units');
    return units === 18 ? formatEther(value) : formatUnits(value, units);
}
export function formatRoundedCurrencyBalance(value, units = 18, decimals = 2) {
    if (value === undefined)
        return '—';
    assertNonNegativeInteger(units, 'Units');
    assertInteger(decimals, 'Decimals');
    if (decimals < 0)
        return formatCurrencyBalance(value, units);
    const isNegative = value < 0n;
    const absoluteValue = isNegative ? -value : value;
    const prefix = isNegative ? '-' : '';
    const effectiveDecimals = getEffectiveRoundedDecimals(absoluteValue, units, decimals);
    const scale = 10n ** BigInt(effectiveDecimals);
    const base = 10n ** BigInt(units);
    const rounded = (absoluteValue * scale + base / 2n) / base;
    const integerPart = rounded / scale;
    if (effectiveDecimals === 0)
        return `${prefix}${formatGroupedInteger(integerPart)}`;
    const fractionalPart = rounded % scale;
    return `${prefix}${formatGroupedInteger(integerPart)}.${fractionalPart.toString().padStart(effectiveDecimals, '0')}`;
}
export function formatCompactCurrencyBalance(value, units = 18, decimals = 1) {
    if (value === undefined)
        return '—';
    assertNonNegativeInteger(units, 'Units');
    assertInteger(decimals, 'Decimals');
    if (decimals < 0)
        return formatCurrencyBalance(value, units);
    const isNegative = value < 0n;
    const absoluteValue = isNegative ? -value : value;
    const unitBase = 10n ** BigInt(units);
    if (absoluteValue < 1000n * unitBase)
        return formatRoundedCurrencyBalance(value, units, decimals);
    const wholeUnits = absoluteValue / unitBase;
    let suffixIndex = Math.floor((wholeUnits.toString().length - 1) / 3) - 1;
    while (suffixIndex < SI_SUFFIXES.length) {
        const divisor = 1000n ** BigInt(suffixIndex + 1) * unitBase;
        const rounded = formatRoundedScaledValue(absoluteValue, divisor, decimals);
        if (rounded.integerPart < 1000n)
            return `${isNegative ? '-' : ''}${rounded.text}${SI_SUFFIXES[suffixIndex]}`;
        suffixIndex += 1;
    }
    return formatScientificCurrencyBalance(value, units, decimals);
}
export function formatTimestamp(timestamp) {
    if (timestamp === 0n)
        return 'Immediate';
    return formatUtcTimestamp(timestamp) ?? `Invalid timestamp (${timestamp.toString()})`;
}
function formatRelativeDuration(seconds) {
    if (seconds < SECONDS_PER_MINUTE)
        return 'less than a minute';
    const days = seconds / SECONDS_PER_DAY;
    const hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR;
    const minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE;
    if (days > 0n)
        return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0n)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
export function formatRelativeTimestamp(timestamp, currentTimestamp) {
    const delta = timestamp - currentTimestamp;
    if (delta === 0n)
        return 'now';
    if (delta > 0n)
        return `in ${formatRelativeDuration(delta)}`;
    return `${formatRelativeDuration(-delta)} ago`;
}
export function formatDuration(seconds) {
    if (seconds <= 0n)
        return '0m';
    if (seconds < SECONDS_PER_MINUTE)
        return 'less than a minute';
    const days = seconds / SECONDS_PER_DAY;
    const hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR;
    const minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE;
    if (days > 0n)
        return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0n)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
//# sourceMappingURL=formatters.js.map