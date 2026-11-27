import { formatTimeAdvance } from '../copy/simulation.js'

function preset(amount: bigint, unit: Parameters<typeof formatTimeAdvance>[1], secondsPerUnit: bigint) {
	return { label: formatTimeAdvance(amount, unit), seconds: amount * secondsPerUnit }
}

const minute = 60n
const hour = 60n * minute
const day = 24n * hour

export const SIMULATION_TIME_PRESETS = [preset(10n, 'min', minute), preset(1n, 'hour', hour), preset(1n, 'day', day), preset(1n, 'week', 7n * day), preset(1n, 'month', 30n * day), preset(1n, 'year', 365n * day)] as const
