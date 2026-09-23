import * as simulationCopy from '../copy/simulation.js'

export const SIMULATION_TIME_PRESETS = [
	{ label: simulationCopy.plus10Minutes, seconds: 10n * 60n },
	{ label: simulationCopy.plus1Hour, seconds: 60n * 60n },
	{ label: simulationCopy.plus1Day, seconds: 24n * 60n * 60n },
	{ label: simulationCopy.plus1Week, seconds: 7n * 24n * 60n * 60n },
	{ label: simulationCopy.plus1Month, seconds: 30n * 24n * 60n * 60n },
	{ label: simulationCopy.plus1Year, seconds: 365n * 24n * 60n * 60n },
] as const
