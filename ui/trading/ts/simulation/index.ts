import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'

export const TRADING_SIMULATION_SCENARIO = 'trading'
export const FUNDED_TRADING_SIMULATION_SCENARIO = 'trading-funded'

export function registerTradingSimulationScenario() {
	registerSimulationScenario(FUNDED_TRADING_SIMULATION_SCENARIO, {
		description: 'A deployed trading market with liquidity and YES, NO, INVALID, and LP shares in the simulation wallet.',
		label: 'Trading with liquidity',
	})
	registerSimulationScenario(TRADING_SIMULATION_SCENARIO, {
		description: 'A seeded Statoblast security pool with the trading factory and router deployed for walletless trade, liquidity, and settlement testing.',
		label: 'Trading market',
	})
}
