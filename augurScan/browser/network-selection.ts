// The network selector only proposes a network; the scanner switches when the user applies the choice.
// The applied network is kept on the select element so every reader sees the same value.

/** Makes `chainId` the applied network. A choice the user has not applied yet stays on screen while the list still offers it. */
export const applyNetworkSelection = (select: HTMLSelectElement, chainId: string, unappliedChoice?: string): void => {
	select.dataset['chainId'] = chainId
	select.value = unappliedChoice !== undefined && [...select.options].some(option => option.value === unappliedChoice) ? unappliedChoice : chainId
}

/** The applied network, or undefined before the first network is applied. */
export const appliedNetwork = (select: HTMLSelectElement): string | undefined => select.dataset['chainId']

/** The network the selector shows when it differs from the applied one. */
export const unappliedNetworkChoice = (select: HTMLSelectElement): string | undefined => {
	const applied = appliedNetwork(select)
	return applied !== undefined && select.value !== applied ? select.value : undefined
}
