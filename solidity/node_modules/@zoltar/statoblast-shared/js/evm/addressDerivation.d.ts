import { type Address, type Hex } from '@zoltar/core-shared/evm/ethereum';
type SecurityPoolCoreAddresses = {
    escalationGameFactory: Address;
    escalationGameProofVerifier: Address;
    openOracle: Address;
    priceOracleManagerAndOperatorQueuerFactory: Address;
    securityPoolFactory: Address;
    securityPoolForker: Address;
    shareTokenFactory: Address;
    uniformPriceDualCapBatchAuctionFactory: Address;
    zoltar: Address;
    zoltarQuestionData: Address;
};
type SecurityPoolAddressConfig = {
    getEscalationGameInitCode: (securityPool: Address, repToken: Address, proofVerifier: Address) => Hex;
    getInfraContracts: () => SecurityPoolCoreAddresses;
    getPriceOracleManagerAndOperatorQueuerInitCode: (openOracle: Address, repToken: Address, initialReportPriorityFeeAttoEthPerGas: bigint) => Hex;
    getRepTokenAddress: (universeId: bigint) => Address;
    getSecurityPoolInitCode: (inputs: {
        escalationGameFactory: Address;
        openOracle: Address;
        parent: Address;
        priceOracleManagerAndOperatorQueuer: Address;
        questionId: bigint;
        statoblastSecurityMultiplierBps: bigint;
        securityPoolFactory: Address;
        securityPoolForker: Address;
        shareToken: Address;
        truthAuction: Address;
        universeId: bigint;
        zoltar: Address;
        zoltarQuestionData: Address;
    }) => Hex;
    getShareTokenInitCode: (securityPoolFactory: Address, zoltarAddress: Address, questionId: bigint) => Hex;
    getTruthAuctionInitCode: (securityPoolForker: Address) => Hex;
};
export declare function getSecurityPoolOriginId(originUniverseId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas?: bigint): `0x${string}`;
export declare function createSecurityPoolAddressHelper(config: SecurityPoolAddressConfig): {
    getSecurityPoolAddresses: (parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, originUniverseId?: bigint, initialReportPriorityFeeAttoEthPerGas?: bigint) => {
        escalationGame: `0x${string}`;
        priceOracleManagerAndOperatorQueuer: `0x${string}`;
        securityPool: `0x${string}`;
        shareToken: `0x${string}`;
        truthAuction: `0x${string}`;
    };
};
export {};
