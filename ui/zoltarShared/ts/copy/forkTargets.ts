export const targetChildUniverses = 'Target child universes'
export const addTarget = 'Add target'
export const removeTarget = 'Remove target'
export const selectScalarTarget = 'Select scalar target'
export const scalarValuePrompt = 'Enter a value'
export const deployedScalarChildren = 'Deployed child universes'
export const noTargetsSelected = 'No target child universes selected.'
export const noTargetsAvailable = 'No target child universes available.'

export function formatSelectedTargetCount(count: number) {
	return count === 1 ? '1 target selected' : `${count.toString()} targets selected`
}
