import { assertNever } from '../lib/assert.js';
export const CORE_SIMULATION_SCENARIOS = ['baseline', 'deployed'];
const scenarioPresentations = new Map();
export function registerSimulationScenario(scenario, presentation) {
    scenarioPresentations.set(scenario, presentation);
}
export function getRegisteredSimulationScenarios() {
    return [...CORE_SIMULATION_SCENARIOS, ...scenarioPresentations.keys()];
}
export function getSimulationScenarioLabel(scenario) {
    const registered = scenarioPresentations.get(scenario);
    if (registered !== undefined)
        return registered.label;
    return getCoreSimulationScenarioLabel(scenario);
}
export function getSimulationScenarioDescription(scenario) {
    const registered = scenarioPresentations.get(scenario);
    if (registered !== undefined)
        return registered.description;
    return getCoreSimulationScenarioDescription(scenario);
}
export function isCoreSimulationScenario(value) {
    return CORE_SIMULATION_SCENARIOS.includes(value);
}
export function normalizeSimulationScenario(value) {
    return value !== undefined && isCoreSimulationScenario(value) ? value : 'baseline';
}
export function getCoreSimulationScenarioLabel(scenario) {
    switch (scenario) {
        case 'baseline':
            return 'Baseline';
        case 'deployed':
            return 'Deployed';
        default:
            return assertNever(scenario);
    }
}
export function getCoreSimulationScenarioDescription(scenario) {
    switch (scenario) {
        case 'baseline':
            return 'Fresh walletless simulation with funded QA accounts and no app contracts deployed. Use it to test the Deploy flow from scratch.';
        case 'deployed':
            return 'App contracts are deployed, but no security pools or questions are created. Use it to test setup flows from an empty deployment.';
        default:
            return assertNever(scenario);
    }
}
//# sourceMappingURL=scenarios.js.map