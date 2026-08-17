import { parseUnits } from '@zoltar/shared/ethereum';
import * as commonCopy from '../copy/common.js';
const DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/;
function normalizeDecimalInput(value) {
    const trimmed = value.trim();
    if (trimmed === '')
        return trimmed;
    if (trimmed === '.' || trimmed === '-.')
        return trimmed;
    return (() => {
        if (trimmed.startsWith('.'))
            return `0${trimmed}`;
        if (trimmed.endsWith('.'))
            return `${trimmed}0`;
        return trimmed;
    })();
}
function hasValidDecimalPrecision(value, units) {
    const fractionalPart = value.split('.')[1];
    if (fractionalPart === undefined)
        return true;
    return fractionalPart.replace(/0+$/, '').length <= units;
}
export function tryParseDecimalInput(value, units = 18) {
    const trimmed = value.trim();
    if (trimmed === '')
        return undefined;
    const normalized = normalizeDecimalInput(trimmed);
    if (!DECIMAL_INPUT_PATTERN.test(normalized))
        return undefined;
    if (!hasValidDecimalPrecision(normalized, units))
        return undefined;
    return parseUnits(normalized, units);
}
export function parseDecimalInput(value, label, units = 18) {
    const trimmed = value.trim();
    if (trimmed === '')
        throw new Error(`${label} is required`);
    const parsed = tryParseDecimalInput(trimmed, units);
    if (parsed === undefined)
        throw new Error(commonCopy.formatDecimalNumberRequiredError(label));
    return parsed;
}
//# sourceMappingURL=decimal.js.map