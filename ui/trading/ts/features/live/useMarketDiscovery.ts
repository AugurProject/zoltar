import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { useRef, useState } from 'preact/hooks'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { createSecurityPoolDeploymentIndex, type LiveMarket, type SecurityPoolDeployment } from '../../protocol/live.js'

type DiscoverySnapshot = {
	configuration: DeploymentConfiguration | undefined
	scope: string
	markets: LiveMarket[]
	discoveryRows: readonly (LiveMarket | undefined)[] | undefined
	discoveryState: 'loading' | 'ready' | 'error' | 'not-found'
	discoveryError: string | undefined
	freshness: DataFreshness
	marketPage: { start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }
}

function emptyDiscovery(configuration: DeploymentConfiguration | undefined, scope: string): DiscoverySnapshot {
	return { configuration, scope, markets: [], discoveryRows: undefined, discoveryState: 'loading', discoveryError: undefined, freshness: { refreshing: false, updatedAt: undefined }, marketPage: { start: 0n, total: 0n, previousStart: undefined, nextStart: undefined } }
}

export function useMarketDiscovery(configuration: DeploymentConfiguration | undefined, scope: string) {
	const [snapshot, setSnapshot] = useState(() => emptyDiscovery(configuration, scope))
	const context = useRef({ configuration, scope })
	context.current = { configuration, scope }
	const matchesContext = (value: Pick<DiscoverySnapshot, 'configuration' | 'scope'>) => value.configuration === configuration && value.scope === scope
	// Navigation must expose loading on its first render, before the route's effect starts its read.
	const current = matchesContext(snapshot) ? snapshot : emptyDiscovery(configuration, scope)
	const update = (apply: (value: DiscoverySnapshot) => DiscoverySnapshot) => {
		if (!matchesContext(context.current)) return
		setSnapshot(previous => apply(matchesContext(previous) ? previous : emptyDiscovery(configuration, scope)))
	}
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current

	return {
		markets: current.markets,
		setMarkets: (markets: DiscoverySnapshot['markets']) => update(value => ({ ...value, markets })),
		// Presentation-only registry slots; balances and persistence receive real markets only.
		discoveryRows: current.discoveryRows,
		setDiscoveryRows: (discoveryRows: DiscoverySnapshot['discoveryRows']) => update(value => ({ ...value, discoveryRows })),
		discoveryState: current.discoveryState,
		setDiscoveryState: (discoveryState: DiscoverySnapshot['discoveryState']) => update(value => ({ ...value, discoveryState })),
		discoveryError: current.discoveryError,
		setDiscoveryError: (discoveryError: DiscoverySnapshot['discoveryError']) => update(value => ({ ...value, discoveryError })),
		freshness: current.freshness,
		setFreshness: (freshness: DataFreshness | ((previous: DataFreshness) => DataFreshness)) => update(value => ({ ...value, freshness: typeof freshness === 'function' ? freshness(value.freshness) : freshness })),
		marketPage: current.marketPage,
		setMarketPage: (marketPage: DiscoverySnapshot['marketPage']) => update(value => ({ ...value, marketPage })),
		deploymentIndex,
	}
}
