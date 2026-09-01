import type { SecurityPoolsView } from '../../features/types.js'

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
