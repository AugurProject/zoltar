export function pickFirstReason(...reasons) {
    for (const reason of reasons) {
        if (reason !== undefined)
            return reason;
    }
    return undefined;
}
export function createActionAvailability(...reasons) {
    const reason = pickFirstReason(...reasons);
    return {
        disabled: reason !== undefined,
        reason,
    };
}
//# sourceMappingURL=actionAvailability.js.map