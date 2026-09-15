export type WalletSummaryState = Readonly<{
	account: `0x${string}` | undefined
	ethAttoEth: bigint | undefined
	repAttoRep: bigint | undefined
	status: 'disconnected' | 'loading' | 'ready' | 'error'
	error: string | undefined
	errorLabel: string | undefined
	universeId: string | undefined
	/** Present when the injected wallet reports a chain other than the deployment chain. */
	networkMismatchReason?: string | undefined
}>

export function walletSummaryForUniverse(summary: WalletSummaryState, selectedUniverseId: string | undefined): WalletSummaryState {
	if (summary.universeId === selectedUniverseId) return summary
	return {
		account: summary.account,
		ethAttoEth: undefined,
		repAttoRep: undefined,
		status: summary.account === undefined ? 'disconnected' : 'loading',
		error: undefined,
		errorLabel: undefined,
		universeId: selectedUniverseId,
		...(summary.networkMismatchReason === undefined ? {} : { networkMismatchReason: summary.networkMismatchReason }),
	}
}

export function routeOwnsLiveWallet(route: string) {
	return route !== 'deploy' && route !== 'help' && route !== 'not-found'
}

export function walletSummaryAfterRouteChange(summary: WalletSummaryState, previousRoute: string, nextRoute: string, selectedUniverseId: string | undefined): WalletSummaryState {
	if (routeOwnsLiveWallet(previousRoute) === routeOwnsLiveWallet(nextRoute)) return summary
	return { account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
}
