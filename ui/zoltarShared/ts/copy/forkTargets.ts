export const targetChildUniverses = 'Target child universes'
export const addTarget = 'Add target'
export const removeTarget = 'Remove target'
export const selectScalarTarget = 'Select scalar target'
export const exactTickPrompt = 'Enter an exact tick'
export const deployedScalarChildren = 'Deployed scalar children'
export const noTargetsSelected = 'No target child universes selected.'
export const noTargetsAvailable = 'No target child universes available.'

export function selectedTargetCount(count: number) {
	return count === 1 ? '1 target selected' : `${count.toString()} targets selected`
}
