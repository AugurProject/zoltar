import { createMemoryClient } from 'tevm';
import { type Address } from '@zoltar/shared/ethereum';
import type { ReadClient, WriteClient } from '../lib/chainBackend.js';
import type { DeploymentStep } from '../types/contracts.js';
import { type NetworkProfile } from '../lib/networkProfile.js';
import type { SimulationScenario } from './scenarios.js';
export type TevmLikeClient = ReturnType<typeof createMemoryClient>;
export type BootstrapProgressHandler = (progress: {
    label: string;
    value: number;
}) => Promise<void> | void;
export declare function reportBootstrapProgress(onProgress: BootstrapProgressHandler | undefined, label: string, value: number): Promise<void>;
export declare function updateZoltarGenesisRepToken({ createWriteClient, memoryClient, repAddress, zoltarAddress }: {
    createWriteClient: (accountAddress: Address) => WriteClient;
    memoryClient: TevmLikeClient;
    repAddress: Address;
    zoltarAddress: Address;
}): Promise<void>;
export declare function mintSimulationGenesisRep({ accountAddress, amount, createWriteClient, memoryClient, repAddress, zoltarAddress }: {
    accountAddress: Address;
    amount: bigint;
    createWriteClient: (accountAddress: Address) => WriteClient;
    memoryClient: TevmLikeClient;
    repAddress: Address;
    zoltarAddress: Address;
}): Promise<void>;
export declare function predictSimulationTokenAddresses(accountAddress: Address): {
    genesisRepTokenAddress: Address;
    wethAddress: Address;
};
export declare function deploySimulationAppContracts(primaryWriteClient: WriteClient, memoryClient: TevmLikeClient, onProgress: BootstrapProgressHandler | undefined, profile: NetworkProfile, range: {
    start: number;
    end: number;
} | undefined, getDeploymentSteps: (profile: NetworkProfile) => readonly DeploymentStep[]): Promise<void>;
export type ProgressRange = {
    end: number;
    start: number;
};
export declare function createRangeProgressReporter(onProgress: BootstrapProgressHandler | undefined, range: ProgressRange, stepCount: number): (label: string) => Promise<void>;
export declare function requireQaAccount(account: Address | undefined, label: string): `0x${string}`;
export type BootstrapScenarioApplyParameters = {
    accounts: readonly Address[];
    createReadClient: () => ReadClient;
    createWriteClient: (accountAddress: Address) => WriteClient;
    memoryClient: TevmLikeClient;
    onProgress: BootstrapProgressHandler | undefined;
    profile: NetworkProfile;
    scenario: SimulationScenario;
};
export declare function bootstrapSimulationChain({ accounts, applyScenario, createReadClient, createWriteClient, getDeploymentSteps, memoryClient, onProgress, primaryAccount, profile, scenario, }: {
    accounts: readonly Address[];
    applyScenario?: (parameters: BootstrapScenarioApplyParameters) => Promise<boolean>;
    createReadClient: () => ReadClient;
    createWriteClient: (accountAddress: Address) => WriteClient;
    getDeploymentSteps: (profile: NetworkProfile) => readonly DeploymentStep[];
    memoryClient: TevmLikeClient;
    onProgress: BootstrapProgressHandler | undefined;
    primaryAccount: Address;
    profile: NetworkProfile;
    scenario: SimulationScenario;
}): Promise<void>;
//# sourceMappingURL=bootstrap.d.ts.map