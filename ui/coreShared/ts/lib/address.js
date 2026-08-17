import { normalizeCaseInsensitiveText, sameCaseInsensitiveText } from './caseInsensitive.js';
export function normalizeAddress(address) {
    return normalizeCaseInsensitiveText(address);
}
export function sameAddress(left, right) {
    return sameCaseInsensitiveText(left, right);
}
//# sourceMappingURL=address.js.map