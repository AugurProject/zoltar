export const childPoolMissing = 'Child pool missing'
export const childPoolReady = 'Child pool ready'
export const noBranchesSelected = 'No child branches selected.'
export const exactTickPrompt = 'Enter an exact tick'
export const invalidTick = 'Invalid'
export const removeScalarTarget = 'Remove scalar target'
export const addScalarTarget = 'Add scalar target'
export const scalarForkTick = 'Scalar fork tick'
export const deployedScalarChildren = 'Deployed scalar children'
export const scalarForkQuestion = 'Scalar fork question'
export const categoricalForkQuestion = 'Categorical fork question'

export function tickPosition(tick: bigint, numTicks: bigint) {
	return `Tick ${tick.toString()} of ${numTicks.toString()}`
}

export function selectedTargetCount(count: number) {
	return count === 1 ? '1 target selected' : `${count.toString()} targets selected`
}
