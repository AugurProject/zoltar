import type { SecurityPoolFunding } from './security-pool-instructions.ts'
import type { SecurityPoolObservation, SecurityPoolScope } from '#monitoring/security-pool-monitor'
import type { Address, Hex, RpcEndpointHealth } from '@zoltar/bot-shared/ethereum'
import type { CentralizedMarketEstimate } from '@zoltar/bot-shared/monitoring/centralized-markets'
import type { MarketConsensusEstimate, MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { Activity, PendingTransactionIntent, PoolObservation, UniverseObservation } from './operator-state.ts'

export type RuntimeState = {
	securityPoolFunding?: Record<string, SecurityPoolFunding> | undefined
	completedSecurityPoolInstructions?: Record<string, string> | undefined
	lastExpiredTakeoverBlock?: bigint | undefined
	activities: Activity[]
	chainId: number
	centralizedMarket: CentralizedMarketEstimate | undefined
	centralizedMarketsByAsset: Map<string, CentralizedMarketEstimate>
	marketConsensus: MarketConsensusEstimate | undefined
	marketConsensusByAsset: Map<string, MarketConsensusEstimate>
	marketObservations: MarketConsensusObservation[]
	error: string | undefined
	deploymentMissingName?: string | undefined
	deploymentCheckedBlock?: bigint | undefined
	deploymentCheckedTimestamp?: bigint | undefined
	lastScanAt: string | undefined
	lastScannedBlock: bigint | undefined
	lastScannedBlockHash: Hex | undefined
	lastScannedTimestamp: bigint | undefined
	paused: boolean
	rpcEndpointHealth: readonly RpcEndpointHealth[]
	pendingTransactions: PendingTransactionIntent[]
	securityPools: SecurityPoolObservation[]
	securityPoolScopes: SecurityPoolScope[]
	pools: PoolObservation[]
	scanning: boolean
	startedAt: string
	status: 'connectivity-degraded' | 'dry-run' | 'error' | 'paused' | 'running' | 'starting'
	universes: UniverseObservation[]
	wallet: Address | undefined
	walletAttoEth: bigint
	walletRepByToken: Map<string, bigint>
}
