import { getAddress, isAddress, isHex } from '@zoltar/shared/ethereum';
import { deriveTokenApprovalRequirement } from './tokenApproval.js';
import { parseBigIntInput, tryParseBigIntInput } from './integerInput.js';
export function tryParseAddressInput(value) {
    const trimmed = value.trim();
    if (trimmed === '' || !isAddress(trimmed))
        return undefined;
    return getAddress(trimmed);
}
export function parseAddressInput(value, label) {
    const trimmed = value.trim();
    if (trimmed === '')
        throw new Error(`${label} is required`);
    const parsed = tryParseAddressInput(value);
    if (parsed === undefined)
        throw new Error(`${label} must be a valid address: ${trimmed}`);
    return parsed;
}
export function resolveOptionalAddressInput(value, fallbackAddress, label) {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '')
        return fallbackAddress;
    return parseAddressInput(trimmed, label);
}
export function parseBytes32Input(value, label) {
    const trimmed = value.trim();
    if (!isHex(trimmed, { strict: true }) || trimmed.length !== 66)
        throw new Error(`${label} must be a 32-byte hex value`);
    return trimmed;
}
export function parseReportIdInput(value) {
    const reportId = parseBigIntInput(value, 'Report ID');
    if (reportId < 0n)
        throw new Error('Report ID must be non-negative');
    return reportId;
}
export function parseOptionalBigIntInput(value) {
    const trimmed = value.trim();
    if (trimmed === '')
        return undefined;
    return tryParseBigIntInput(trimmed);
}
function parseListInput(value, label, parseItem) {
    const values = value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry !== '');
    if (values.length === 0)
        throw new Error(`${label} is required`);
    return values.map(parseItem);
}
function getListEntries(value) {
    return value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry !== '');
}
export function parseBigIntListInput(value, label) {
    return parseListInput(value, label, (entry, index) => {
        const parsed = tryParseBigIntInput(entry);
        if (parsed === undefined)
            throw new Error(`${label} #${index + 1} must be a whole number`);
        return parsed;
    });
}
export function tryParseBigIntListInput(value) {
    const entries = getListEntries(value);
    if (entries.length === 0)
        return undefined;
    const parsedEntries = [];
    for (const entry of entries) {
        const parsed = tryParseBigIntInput(entry);
        if (parsed === undefined)
            return undefined;
        parsedEntries.push(parsed);
    }
    return parsedEntries;
}
export function resolveOptionalBigIntListInput(value, fallback, label) {
    const trimmed = value.trim();
    if (trimmed === '')
        return fallback;
    return parseBigIntListInput(trimmed, label);
}
export function parseReportingOutcomeInput(value) {
    switch (value) {
        case 'invalid':
        case 'yes':
        case 'no':
            return value;
        default:
            throw new Error(`Unknown reporting outcome: ${value}`);
    }
}
export function getReportingOutcomeKey(outcome) {
    if (typeof outcome !== 'bigint')
        return outcome;
    switch (outcome) {
        case 0n:
            return 'invalid';
        case 1n:
            return 'yes';
        case 2n:
            return 'no';
        default:
            throw new Error(`Unsupported child universe outcome index: ${outcome.toString()}`);
    }
}
export function approvalShortage(amount, allowance) {
    return deriveTokenApprovalRequirement(amount, allowance).neededAmount;
}
export function approvalTargetAmount(amount, allowance) {
    return deriveTokenApprovalRequirement(amount, allowance).targetAmount;
}
export function balanceShortage(amount, balance) {
    if (amount === undefined || balance === undefined)
        return undefined;
    return amount > balance ? amount - balance : 0n;
}
export function parseReportingOutcomeListInput(value, label) {
    return parseListInput(value, label, entry => parseReportingOutcomeInput(entry.toLowerCase()));
}
//# sourceMappingURL=inputs.js.map