type OpenOraclePriceValueProps = {
    currentTimestamp?: bigint | undefined;
    lastPrice: bigint | undefined;
    lastSettlementTimestamp: bigint;
    priceValidUntilTimestamp: bigint | undefined;
};
export declare function OpenOraclePriceValue({ currentTimestamp, lastPrice, lastSettlementTimestamp, priceValidUntilTimestamp }: OpenOraclePriceValueProps): "Unavailable" | import("preact").JSX.Element;
export {};
//# sourceMappingURL=OpenOraclePriceValue.d.ts.map