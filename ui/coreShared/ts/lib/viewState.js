export function resolveEnumValue(value, fallback, allowedValues) {
    if (value !== undefined && allowedValues.includes(value))
        return value;
    return fallback;
}
export function resolveFirstMatchingValue(entries, fallback) {
    for (const [matches, value] of entries) {
        if (matches)
            return value;
    }
    return fallback;
}
//# sourceMappingURL=viewState.js.map