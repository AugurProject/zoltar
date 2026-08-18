import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js';
import { applyStatoblastScenario, getStatoblastScenarioDescription, getStatoblastScenarioLabel } from './statoblastScenarios.js';
const STATOBLAST_SCENARIOS = ['security-pool', 'securitypoolx2', 'securitypoolx2-auction'];
export function isStatoblastScenario(value) {
    return STATOBLAST_SCENARIOS.includes(value);
}
export { applyStatoblastScenario, getStatoblastScenarioDescription, getStatoblastScenarioLabel };
export function registerStatoblastSimulationScenarios() {
    for (const scenario of STATOBLAST_SCENARIOS) {
        registerSimulationScenario(scenario, {
            description: getStatoblastScenarioDescription(scenario),
            label: getStatoblastScenarioLabel(scenario),
        });
    }
}
//# sourceMappingURL=index.js.map