import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'

export const TRADING_SIMULATION_SCENARIO = 'trading'

export function registerTradingSimulationScenario() {
	registerSimulationScenario(TRADING_SIMULATION_SCENARIO, {
		description: 'A seeded Statoblast security pool with the trading factory and router deployed for walletless trade, liquidity, and settlement testing.',
		label: 'Trading market',
	})
}
