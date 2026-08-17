type SupportedNetworkChangeCoordinatorParameters = {
    getInFlightCount: () => number;
    replaceEnvironment: (canCommit: () => boolean) => Promise<boolean>;
};
export declare function createSupportedNetworkChangeCoordinator({ getInFlightCount, replaceEnvironment }: SupportedNetworkChangeCoordinatorParameters): {
    handleSupportedNetworkChange: () => Promise<void>;
    handleTransactionFinished: () => Promise<void>;
};
export {};
//# sourceMappingURL=supportedNetworkChange.d.ts.map