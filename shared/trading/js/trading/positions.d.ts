import { type SwapQuote } from './math.js';
export type EnterPositionQuote = Readonly<{
    longOutcome: 'YES' | 'NO';
    completeSetShares: bigint;
    oppositeSharesSwapped: bigint;
    additionalLongShares: bigint;
    totalLongShares: bigint;
    invalidInsurance: bigint;
    feeAmount: bigint;
}>;
export type ExitPositionQuote = Readonly<{
    longOutcome: 'YES' | 'NO';
    completeSetShares: bigint;
    longSharesSwapped: bigint;
    totalLongShares: bigint;
    invalidRequired: bigint;
    feeAmount: bigint;
}>;
export declare function quoteEnterPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, yesReserve: bigint, noReserve: bigint, feeBps: bigint): EnterPositionQuote;
export declare function quoteExitPosition(longOutcome: 'YES' | 'NO', completeSetShares: bigint, yesReserve: bigint, noReserve: bigint, feeBps: bigint): ExitPositionQuote;
export type MaximumExitParameters = Readonly<{
    longOutcome: 'YES' | 'NO';
    longBalance: bigint;
    invalidBalance: bigint;
    yesReserve: bigint;
    noReserve: bigint;
    feeBps: bigint;
    maximumLongInput?: bigint;
}>;
export declare function maximumInsuredExit(parameters: MaximumExitParameters): bigint;
export declare function minimumAfterSlippage(amount: bigint, slippageBps: bigint): bigint;
export declare function maximumAfterSlippage(amount: bigint, slippageBps: bigint): bigint;
export declare function inputOutcomeConditionalPriceImpact(inputOutcome: 'YES' | 'NO', beforeInputReserve: bigint, beforeOutputReserve: bigint, quote: SwapQuote): {
    inputOutcome: "YES" | "NO";
    before: {
        numerator: bigint;
        denominator: bigint;
    };
    after: {
        numerator: bigint;
        denominator: bigint;
    };
};
