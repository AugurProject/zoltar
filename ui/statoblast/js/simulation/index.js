import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js';
import { getStatoblastScenarioDescription, getStatoblastScenarioLabel } from './statoblastScenarios.js';
const STATOBLAST_SCENARIOS = ['security-pool', 'securitypoolx2', 'securitypoolx2-auction'];
export function isStatoblastScenario(value) {
    return STATOBLAST_SCENARIOS.includes(value);
}
export { getStatoblastScenarioDescription, getStatoblastScenarioLabel };
export function registerStatoblastSimulationScenarios() {
    for (const scenario of STATOBLAST_SCENARIOS) {
        registerSimulationScenario(scenario, {
            description: getStatoblastScenarioDescription(scenario),
            label: getStatoblastScenarioLabel(scenario),
        });
    }
}
//# sourceMappingURL=index.js.map