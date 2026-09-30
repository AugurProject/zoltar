import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'

export function shouldAutoLoadUniverseDirectory({
	activeSecurityPoolsView,
	canReadOnchainData,
	currentContextKey,
	hasLoadedUniverseDirectoryPools,
	lastAutoLoadContextKey,
	loadingUniverseDirectoryPools,
	securityPoolUniverseDirectoryError,
}: {
	activeSecurityPoolsView: SecurityPoolsView
	canReadOnchainData: boolean
	currentContextKey: string
	hasLoadedUniverseDirectoryPools: boolean
	lastAutoLoadContextKey: string | undefined
	loadingUniverseDirectoryPools: boolean
	securityPoolUniverseDirectoryError: string | undefined
}) {
	if (activeSecurityPoolsView !== 'universes' || !canReadOnchainData || loadingUniverseDirectoryPools || hasLoadedUniverseDirectoryPools) return false
	if (securityPoolUniverseDirectoryError === undefined) return true
	return lastAutoLoadContextKey !== currentContextKey
}

/** Universe directory figures are per environment, wallet account, and universe; switching any of them invalidates loaded figures. */
export function getUniverseDirectoryContextKey({ accountAddress, environmentNonce, universeId }: { accountAddress: string | undefined; environmentNonce: number; universeId: bigint }) {
	return `${environmentNonce.toString()}:${accountAddress?.toLowerCase() ?? 'no-account'}:${universeId.toString()}`
}

export function isUniverseDirectoryLoadedForContext({ currentContextKey, hasLoadedUniverseDirectoryPools, loadedContextKey }: { currentContextKey: string; hasLoadedUniverseDirectoryPools: boolean; loadedContextKey: string | undefined }) {
	return hasLoadedUniverseDirectoryPools && loadedContextKey === currentContextKey
}
