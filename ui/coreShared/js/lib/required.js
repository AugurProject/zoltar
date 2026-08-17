export function requireDefined(value, message) {
    if (value === undefined)
        throw new Error(message);
    return value;
}
//# sourceMappingURL=required.js.map