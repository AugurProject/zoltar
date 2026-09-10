export declare const BPS_DENOMINATOR = 10000n;
export type SwapQuote = Readonly<{
    amountIn: bigint;
    amountOut: bigint;
    netInput: bigint;
    feeAmount: bigint;
}>;
export declare function ceilDiv(numerator: bigint, denominator: bigint): bigint;
export declare function quoteExactInput(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): SwapQuote;
export declare function quoteExactOutput(reserveIn: bigint, reserveOut: bigint, amountOut: bigint, feeBps: bigint): SwapQuote;
export declare function conditionalYesProbability(yesReserve: bigint, noReserve: bigint): {
    numerator: bigint;
    denominator: bigint;
};
export declare function conditionalNoProbability(yesReserve: bigint, noReserve: bigint): {
    numerator: bigint;
    denominator: bigint;
};
export declare function quoteInitialLiquidity(completeSets: bigint, conditionalYesBps: bigint): {
    invalidReturned: bigint;
    yesReturned: bigint;
    noReturned: bigint;
    yesUsed: bigint;
    noUsed: bigint;
};
export declare function quoteAddLiquidity(yesReserve: bigint, noReserve: bigint, maxYes: bigint, maxNo: bigint): {
    yesUsed: bigint;
    noUsed: bigint;
    yesReturned: bigint;
    noReturned: bigint;
};
export declare function quoteRemoveLiquidity(yesReserve: bigint, noReserve: bigint, liquidity: bigint, totalSupply: bigint): {
    yesOut: bigint;
    noOut: bigint;
};
