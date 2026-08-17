export function normalizeCaseInsensitiveText(value) {
    return value?.trim().toLowerCase();
}
export function sameCaseInsensitiveText(left, right) {
    const normalizedLeft = normalizeCaseInsensitiveText(left);
    const normalizedRight = normalizeCaseInsensitiveText(right);
    return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}
//# sourceMappingURL=caseInsensitive.js.map