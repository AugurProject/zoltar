type OpenOraclePriceValueProps = {
    currentTimestamp?: bigint | undefined;
    lastPrice: bigint | undefined;
    lastSettlementTimestamp: bigint;
    priceValidUntilTimestamp: bigint | undefined;
};
export declare function OpenOraclePriceValue({ currentTimestamp, lastPrice, lastSettlementTimestamp, priceValidUntilTimestamp }: OpenOraclePriceValueProps): import("preact").JSX.Element | "Unavailable";
export {};
//# sourceMappingURL=OpenOraclePriceValue.d.ts.map