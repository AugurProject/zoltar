import type { ChainBackend } from './chainBackend.js';
import { createInjectedBackend } from './chainBackend.js';
import { type NetworkProfile } from './networkProfile.js';
import type { SimulationController } from '../simulation/controller.js';
import { createSimulationBackend } from '../simulation/tevmBackend.js';
type LocationLike = {
    hash?: string;
    hostname: string;
    search: string;
};
type InitializeActiveEnvironmentDependencies = {
    createInjectedBackend?: typeof createInjectedBackend;
    createSimulationBackend: typeof createSimulationBackend;
};
export declare function shouldUseSimulationLocation(location: LocationLike): boolean;
export declare function shouldFollowWalletNetwork(location?: LocationLike): boolean;
type InitializeActiveEnvironmentOptions = {
    shouldCommit?: () => boolean;
};
export declare function initializeActiveEnvironment(location?: LocationLike, dependencies?: InitializeActiveEnvironmentDependencies, options?: InitializeActiveEnvironmentOptions): Promise<ChainBackend>;
export declare function getActiveBackend(): ChainBackend;
export declare function getActiveNetworkProfile(): NetworkProfile;
export declare function getActiveSimulationController(): SimulationController | undefined;
export declare function installActiveEnvironmentForTesting(backend: ChainBackend, simulationController?: SimulationController): () => void;
export declare function resetActiveEnvironmentForTesting(): void;
export {};
//# sourceMappingURL=activeEnvironment.d.ts.map