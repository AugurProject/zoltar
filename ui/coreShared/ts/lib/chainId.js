export function parseChainId(chainId) {
    if (chainId === undefined)
        return undefined;
    try {
        return BigInt(chainId);
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return undefined;
        throw error;
    }
}
export function sameChainId(left, right) {
    const parsedLeft = parseChainId(left);
    const parsedRight = parseChainId(right);
    return parsedLeft !== undefined && parsedRight !== undefined && parsedLeft === parsedRight;
}
//# sourceMappingURL=chainId.js.map