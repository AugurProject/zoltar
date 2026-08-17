import type { SimulationScenario } from './scenarios.js';
declare const SAVED_SIMULATION_STATE_VERSION: 1;
type SimulationSnapshotV1 = {
    blockCountSinceReset: bigint;
    currentTimestamp: bigint;
    queryDelayMilliseconds: number;
    repPerEthPrice: bigint;
    repPerUsdcPrice: bigint;
    selectedAccount: string;
    snapshot: Record<string, unknown>;
    transactionCountSinceReset: bigint;
    transactionDelayMilliseconds: number;
};
export type SavedSimulationStateEnvelopeV1 = {
    baseScenario: SimulationScenario;
    name: string;
    savedAt: string;
    state: SimulationSnapshotV1;
    version: typeof SAVED_SIMULATION_STATE_VERSION;
};
export type SavedSimulationStateRecord = {
    baseScenario: SimulationScenario;
    id: string;
    name: string;
    persistedAt: string;
    savedAt: string;
    serialized: string;
};
export type SavedSimulationStateStorageSummary = {
    records: SavedSimulationStateRecord[];
    warning: string | undefined;
};
export type SimulationSource = {
    kind: 'scenario';
    scenario: SimulationScenario;
} | {
    baseScenario: SimulationScenario;
    kind: 'saved-state';
    name: string;
    savedAt: string;
    stateId: string;
};
export type SimulationInitialization = {
    kind: 'scenario';
    scenario: SimulationScenario;
} | {
    envelope: SavedSimulationStateEnvelopeV1;
    kind: 'saved-state';
    stateId: string;
};
export declare function serializeSavedSimulationStateEnvelope(envelope: SavedSimulationStateEnvelopeV1): string;
export declare function parseSavedSimulationStateEnvelope(serialized: string): SavedSimulationStateEnvelopeV1;
export declare function getSavedSimulationStateStorageSummary(storage?: Storage): SavedSimulationStateStorageSummary;
export declare function removeCorruptedSavedSimulationStates(storage?: Storage): number;
export declare function getSavedSimulationStateEnvelope(stateId: string, storage?: Storage): SavedSimulationStateEnvelopeV1 | undefined;
export declare function persistSavedSimulationState(serialized: string, storage?: Storage): SavedSimulationStateRecord;
export declare function deleteSavedSimulationState(stateId: string, storage?: Storage): boolean;
export {};
//# sourceMappingURL=savedStates.d.ts.map