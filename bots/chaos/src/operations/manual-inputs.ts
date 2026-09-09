import type { PlanningOptions } from './types.ts'

export type ManualInput = { source: 'chaosbot' } | { source: 'custom'; value: string }
export type ManualInputs = Record<string, ManualInput>

const amountFields = [
	['maxEthSpendAttoEth', 'Maximum ETH spend (attoETH)', 'maximum'],
	['maxRepSpendAttoRep', 'Maximum REP spend (attoREP)', 'maximum'],
	['minimumEthReserveAttoEth', 'ETH reserve (attoETH)', 'minimum'],
	['minimumRepReserveAttoRep', 'REP reserve (attoREP)', 'minimum'],
] as const

export function manualInputFields(options: PlanningOptions) {
	return [{ key: 'seed', label: 'Selection seed', value: options.seed.toString() }, ...amountFields.map(([key, label]) => ({ key, label, value: options[key] ?? '0' }))]
}

export function resolveManualInputs(defaults: PlanningOptions, inputs: ManualInputs): PlanningOptions {
	const result = { ...defaults }
	const known = new Set(manualInputFields(defaults).map(field => field.key))
	for (const [key, input] of Object.entries(inputs)) {
		if (!known.has(key)) throw new Error('Unknown operation input')
		if (input.source === 'chaosbot') continue
		if (!/^(0|[1-9]\d*)$/.test(input.value) || input.value.length > 78) throw new Error('Enter a whole, non-negative number in the displayed units')
		const value = BigInt(input.value)
		if (key === 'seed') {
			if (value > 0xffff_ffffn) throw new Error('Selection seed must be between 0 and 4294967295')
			result.seed = Number(value)
		} else {
			const field = amountFields.find(([name]) => name === key)
			if (field === undefined) throw new Error('Unknown amount input')
			const [name, label, boundary] = field
			const configured = BigInt(defaults[name] ?? '0')
			if (value >= 1n << 256n) throw new Error(`${label} exceeds the uint256 range`)
			if (boundary === 'maximum' && value > configured) throw new Error(`${label} exceeds operator policy`)
			if (boundary === 'minimum' && value < configured) throw new Error(`${label} is below operator policy`)
			result[name] = input.value
		}
	}
	return result
}

export function restoreOperationPlanningInputs(defaults: PlanningOptions, values: Record<string, string> | undefined): PlanningOptions {
	if (values === undefined) return defaults
	const result = { ...defaults, operationInputs: values }
	for (const [key, , boundary] of amountFields) {
		const stored = values[key]
		if (stored === undefined) continue
		if (!/^(0|[1-9]\d*)$/.test(stored) || stored.length > 78) throw new Error('Invalid stored planning limit')
		const current = BigInt(defaults[key] ?? '0')
		const previous = BigInt(stored)
		const keepStored = boundary === 'maximum' ? previous < current : previous > current
		result[key] = (keepStored ? previous : current).toString()
	}
	return result
}
