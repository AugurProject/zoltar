import { createTradingPairIndex } from '../../protocol/marketDiscovery.js'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { useRef, useState } from 'preact/hooks'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import { createSecurityPoolDeploymentIndex, type LiveMarket, type SecurityPoolDeployment } from '../../protocol/live.js'

export function useMarketDiscovery() {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	// The age of the committed discovery and whether a background refresh is re-reading it.
	const [freshness, setFreshness] = useState<DataFreshness>({ refreshing: false, updatedAt: undefined })
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const pairIndex = useRef(createTradingPairIndex()).current
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current

	return { freshness, setFreshness, markets, setMarkets, discoveryState, setDiscoveryState, discoveryError, setDiscoveryError, marketPage, setMarketPage, deploymentIndex, pairIndex }
}
