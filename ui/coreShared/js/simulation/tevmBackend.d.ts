import type { ChainBackend } from '../lib/chainBackend.js';
import type { SimulationController } from './controller.js';
import type { SimulationScenario } from './scenarios.js';
import type { SavedSimulationStateEnvelopeV1 } from './savedStates.js';
import type { SimulationWorkerEvent, SimulationWorkerMessage } from './tevmWorkerProtocol.js';
type SimulationWorkerConnection = {
    clearHandlers: () => void;
    postMessage: (message: SimulationWorkerMessage) => void;
    setErrorHandler: (handler: (event: ErrorEvent) => void) => void;
    setMessageErrorHandler: (handler: () => void) => void;
    setMessageHandler: (handler: (event: MessageEvent<SimulationWorkerEvent>) => void) => void;
    terminate: () => void;
};
type CreateSimulationBackendDependencies = {
    createWorkerConnection?: (workerPath: URL) => SimulationWorkerConnection;
};
type SimulationBackend = ChainBackend & SimulationController & {
    bootstrap(): Promise<void>;
};
export declare function createSimulationBackend({ appId, initialBootstrapError, savedState, savedStateId, scenario }: {
    appId?: 'zoltar' | 'statoblast';
    initialBootstrapError?: string;
    savedState?: SavedSimulationStateEnvelopeV1;
    savedStateId?: string;
    scenario?: SimulationScenario;
}, dependencies?: CreateSimulationBackendDependencies): Promise<SimulationBackend>;
export {};
//# sourceMappingURL=tevmBackend.d.ts.map