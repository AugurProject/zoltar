import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { useRef, useState } from 'preact/hooks'
import { createSecurityPoolDeploymentIndex, type LiveMarket, type SecurityPoolDeployment } from '../../protocol/live.js'

export function useMarketDiscovery() {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [selectedPool, setSelectedPool] = useState<Address>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current

	return { markets, setMarkets, selectedPool, setSelectedPool, discoveryState, setDiscoveryState, discoveryError, setDiscoveryError, marketPage, setMarketPage, deploymentIndex }
}
