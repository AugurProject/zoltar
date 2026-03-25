import type { Address } from 'viem'

export type Route = 'deploy' | 'markets'

export type AccountState = {
	address: Address | null
	chainId: string | null
	ethBalance: bigint | null
	repBalance: bigint | null
}

export type MarketFormState = {
	title: string
	description: string
	startTime: string
	endTime: string
	securityMultiplier: string
	currentRetentionRate: string
	startingRepEthPrice: string
}
