import { getAddress, isAddress } from '@zoltar/shared/ethereum';
export function requireArrayValue(value, context) {
    if (Array.isArray(value))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
export function requireTupleValue(value, length, context) {
    const tuple = requireArrayValue(value, context);
    if (tuple.length === length)
        return tuple;
    throw new Error(`Unexpected ${context} response`);
}
export function requireBigintValue(value, context) {
    if (typeof value === 'bigint')
        return value;
    throw new Error(`Unexpected ${context} response`);
}
export function requireIntegerLikeValue(value, context) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number' && Number.isInteger(value))
        return value;
    throw new Error(`Unexpected ${context} response`);
}
export function requireBooleanValue(value, context) {
    if (typeof value === 'boolean')
        return value;
    throw new Error(`Unexpected ${context} response`);
}
export function requireAddressValue(value, context) {
    if (typeof value === 'string' && isAddress(value))
        return getAddress(value);
    throw new Error(`Unexpected ${context} response`);
}
export function requireObjectValue(value, context) {
    if (typeof value === 'object' && value !== null)
        return value;
    throw new Error(`Unexpected ${context} response`);
}
//# sourceMappingURL=decoders.js.map