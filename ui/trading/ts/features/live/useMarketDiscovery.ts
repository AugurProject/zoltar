import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { useRef, useState } from 'preact/hooks'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import { createSecurityPoolDeploymentIndex, type LiveMarket, type SecurityPoolDeployment } from '../../protocol/live.js'

export function useMarketDiscovery() {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	// Presentation-only registry slots; balances and persistence receive real markets only.
	const [discoveryRows, setDiscoveryRows] = useState<readonly (LiveMarket | undefined)[]>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	// The age of the committed discovery and whether a background refresh is re-reading it.
	const [freshness, setFreshness] = useState<DataFreshness>({ refreshing: false, updatedAt: undefined })
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current

	return { discoveryRows, setDiscoveryRows, freshness, setFreshness, markets, setMarkets, discoveryState, setDiscoveryState, discoveryError, setDiscoveryError, marketPage, setMarketPage, deploymentIndex }
}
