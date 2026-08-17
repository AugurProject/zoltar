import { type Address, type Hash, type Hex } from '@zoltar/shared/ethereum';
import type { ChainBackend, ReadClient } from '../lib/chainBackend.js';
import { createSimulationProfile } from '../lib/networkProfile.js';
import { type BootstrapScenarioApplyParameters } from './bootstrap.js';
import { type SimulationInitialization } from './savedStates.js';
import type { SimulationWorkerState } from './tevmWorkerProtocol.js';
type RequestArguments = {
    method: string;
    params?: unknown;
};
type SimulationEngine = {
    accounts: readonly Address[];
    advanceTime(seconds: bigint): Promise<void>;
    bootstrap(): Promise<void>;
    exportState(name: string): Promise<string>;
    getAccounts(): Promise<readonly Address[]>;
    getChainId(): Promise<string>;
    getProfile(): ChainBackend['profile'];
    getState(): SimulationWorkerState;
    installSimulationProxyDeployer(parameters: {
        address: Address;
        runtimeCode: Hex;
    }): Promise<void>;
    mintRep(amount: bigint): Promise<void>;
    mineBlock(): Promise<void>;
    patchSimulationGenesisRepToken(parameters: {
        repAddress: Address;
        zoltarAddress: Address;
    }): Promise<void>;
    request(parameters: RequestArguments): Promise<unknown>;
    reset(): Promise<void>;
    selectAccount(address: Address): Promise<void>;
    setRepPerEthPrice(value: bigint): void;
    setRepPerUsdcPrice(value: bigint): void;
    setQueryDelayMilliseconds(value: number): void;
    setTransactionDelayMilliseconds(value: number): void;
    subscribe(handler: () => void): () => void;
    waitForTransactionReceipt(hash: Hash): Promise<Awaited<ReturnType<ReadClient['getTransactionReceipt']>>>;
    waitUntilReady(): Promise<void>;
};
export type SimulationEngineDependencies = {
    applyScenario?: (parameters: BootstrapScenarioApplyParameters) => Promise<boolean>;
    getDeploymentSteps: (profile: ReturnType<typeof createSimulationProfile>) => readonly import('../types/contracts.js').DeploymentStep[];
    getZoltarAddress: (profile: ReturnType<typeof createSimulationProfile>) => Address;
};
export declare function createSimulationEngine({ initialization, dependencies }: {
    initialization: SimulationInitialization;
    dependencies: SimulationEngineDependencies;
}): Promise<SimulationEngine>;
export {};
//# sourceMappingURL=tevmEngine.d.ts.map