import { parseDecimalInput, tryParseDecimalInput } from './decimal.js';
export function parseRepAmountInput(value, label) {
    return parseDecimalInput(value, label, 18);
}
export function parseEthAmountInput(value, label) {
    return parseDecimalInput(value, label, 18);
}
export function tryParseRepAmountInput(value) {
    return tryParseDecimalInput(value, 18);
}
export function tryParseEthAmountInput(value) {
    return tryParseDecimalInput(value, 18);
}
export function parseOptionalRepAmountInput(value) {
    const trimmed = value.trim();
    if (trimmed === '')
        return undefined;
    return tryParseRepAmountInput(trimmed);
}
export function parseTradingAmountInput(value, label) {
    return parseDecimalInput(value, label, 18);
}
export function tryParseTradingAmountInput(value) {
    return tryParseDecimalInput(value, 18);
}
export function parseTruthAuctionPriceInput(value, label) {
    return parseDecimalInput(value, label, 18);
}
export function tryParseTruthAuctionPriceInput(value) {
    return tryParseDecimalInput(value, 18);
}
export function parseTruthAuctionAmountInput(value, label) {
    return parseDecimalInput(value, label, 18);
}
export function tryParseTruthAuctionAmountInput(value) {
    return tryParseDecimalInput(value, 18);
}
export function tryParseTimestampInput(value) {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed))
        return BigInt(trimmed);
    const timestampMs = new Date(value).getTime();
    if (Number.isNaN(timestampMs))
        return undefined;
    return BigInt(Math.floor(timestampMs / 1000));
}
export function parseTimestampInput(value, label) {
    const timestamp = tryParseTimestampInput(value);
    if (timestamp === undefined)
        throw new Error(`${label} is invalid`);
    if (timestamp < 0n)
        throw new Error(`${label} must not be before the Unix epoch`);
    return timestamp;
}
//# sourceMappingURL=formInputs.js.map