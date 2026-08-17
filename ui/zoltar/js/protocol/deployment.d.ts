import { type Address, type Hash, type Hex } from '@zoltar/shared/ethereum';
import { type RpcStateRetryWait } from './core.js';
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
import { type NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js';
export declare const PROXY_DEPLOYER_RUNTIME_CODE = "0x60003681823780368234f58015156014578182fd5b80825250506014600cf3";
export declare const CANONICAL_DEPLOYER_RAW_GAS_PRICE = 100000000000n;
export declare const CANONICAL_DEPLOYER_RAW_TRANSACTION_COST = 10000000000000000n;
export declare const EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Record<DeploymentStepId, Hash>>;
export declare const STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID: {
    deploymentStatusOracle: `0x${any}`;
    escalationGameClaimDelegate: `0x${any}`;
    multicall3: `0x${any}`;
    openOracle: `0x${any}`;
    scalarOutcomes: `0x${any}`;
    uniformPriceDualCapBatchAuctionFactory: `0x${any}`;
    weth: `0x${any}`;
    zoltarQuestionData: `0x${any}`;
};
export declare function assertStaticDeploymentArtifactRuntimeCodeHashes(parameters?: {
    expectedRuntimeCodeHashes: Readonly<Record<string, Hash | undefined>>;
    runtimeCodeByStepId: Readonly<Record<string, Hex>>;
}): void;
export declare const ATOMIC_FUNDING_SOURCE = "pragma solidity 0.8.17;\ncontract AtomicFunding {\n    constructor(address payable signer, address expectedDeployer, uint256 requiredBalance) payable {\n        if (expectedDeployer.code.length == 0) {\n            uint256 balance = signer.balance;\n            if (balance < requiredBalance) {\n                (bool success,) = signer.call{value: requiredBalance - balance}(\"\");\n                require(success, \"Funding failed\");\n            }\n        }\n        selfdestruct(payable(msg.sender));\n    }\n}";
export declare const ATOMIC_FUNDING_BYTECODE = "0x608060405260405161016e38038061016e83398101604081905261002291610103565b816001600160a01b03163b6000036100e8576001600160a01b03831631818110156100e65760006001600160a01b03851661005d8385610146565b604051600081818185875af1925050503d8060008114610099576040519150601f19603f3d011682016040523d82523d6000602084013e61009e565b606091505b50509050806100e45760405162461bcd60e51b815260206004820152600e60248201526d119d5b991a5b99c819985a5b195960921b604482015260640160405180910390fd5b505b505b33ff5b6001600160a01b038116811461010057600080fd5b50565b60008060006060848603121561011857600080fd5b8351610123816100eb565b6020850151909350610134816100eb565b80925050604084015190509250925092565b8181038181111561016757634e487b7160e01b600052601160045260246000fd5b9291505056fe";
export declare function getProxyDeployerFundingShortfall(client: Pick<ReadClient, 'getBalance'>): Promise<bigint>;
export declare function getProxyDeployerActivity(client: Pick<ReadClient, 'getBalance' | 'getTransactionCount'>): Promise<{
    confirmedNonce: bigint;
    deploymentPending: boolean;
    fundingPending: boolean;
    pending: boolean;
}>;
export declare function assertCanonicalRawTransactionFeeCompatible(client: Pick<ReadClient, 'getBlock'>, label: string): Promise<void>;
export declare function isInsufficientFundsError(error: unknown): boolean;
export declare function fundCanonicalDeployerSigner(client: WriteClient, parameters: {
    expectedDeployer: Address;
    label: string;
    requiredBalance: bigint;
    signer: Address;
}): Promise<{
    hash: Hash;
    receipt: import("@zoltar/shared/ethereum").TransactionReceipt;
}>;
export declare function getDeploymentSteps(profile?: NetworkProfile, wait?: RpcStateRetryWait): DeploymentStep[];
export declare function assertDeploymentStepRuntimeCode(step: Pick<DeploymentStep, 'address' | 'expectedRuntimeCodeHash' | 'id' | 'trustedSimulationCodePresence'>, code: Hex | undefined): boolean;
export declare function loadDeploymentStatusOracleSnapshot(client: Pick<ReadClient, 'readContract' | 'getCode'>): Promise<DeploymentStatusSnapshot>;
export declare function loadErc20Balance(client: ReadClient, tokenAddress: Address, ownerAddress: Address): Promise<bigint>;
export declare function loadErc20Allowance(client: ReadClient, tokenAddress: Address, ownerAddress: Address, spenderAddress: Address): Promise<bigint>;
//# sourceMappingURL=deployment.d.ts.map