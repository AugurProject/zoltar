export declare const CORE_SIMULATION_SCENARIOS: readonly ["baseline", "deployed"];
export type CoreSimulationScenario = (typeof CORE_SIMULATION_SCENARIOS)[number];
export type SimulationScenario = string;
type ScenarioPresentation = {
    description: string;
    label: string;
};
export declare function registerSimulationScenario(scenario: SimulationScenario, presentation: ScenarioPresentation): void;
export declare function getRegisteredSimulationScenarios(): readonly SimulationScenario[];
export declare function getSimulationScenarioLabel(scenario: SimulationScenario): string;
export declare function getSimulationScenarioDescription(scenario: SimulationScenario): string;
export declare function isCoreSimulationScenario(value: string): value is CoreSimulationScenario;
export declare function normalizeSimulationScenario(value: string | undefined): CoreSimulationScenario;
export declare function getCoreSimulationScenarioLabel(scenario: CoreSimulationScenario): "Deployed" | "Baseline";
export declare function getCoreSimulationScenarioDescription(scenario: CoreSimulationScenario): "Fresh walletless simulation with funded QA accounts and no app contracts deployed. Use it to test the Deploy flow from scratch." | "App contracts are deployed, but no security pools or questions are created. Use it to test setup flows from an empty deployment.";
export {};
//# sourceMappingURL=scenarios.d.ts.map