import type { Account, Address, Chain, PublicClient, Transport, WalletClient } from '@zoltar/bot-shared/ethereum'
import type { Configuration } from '#config/configuration'
import { STANDARD_UNISWAP_FEES } from '#core/uniswap-v4'
import type { ArbitrageQuote } from '#core/strategy'
import type { Venue } from '#core/venue-strategy'
import type { EvaluatedOpportunitySnapshot, SkippedOpportunitySnapshot } from '#state/opportunity-snapshot'
import type { MarketConsensusEstimate, MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

export type Pool = {
	address: Address
	fee: (typeof STANDARD_UNISWAP_FEES)[number]
	token: Address
} & ({ venue: 'uniswap-v3'; liquidity: bigint; spotTick: bigint; twapTick: bigint } | { venue: 'uniswap-v2' | 'uniswap-v4' })

export type RawBalances = {
	ethAttoEth: bigint
	repAttoRep: bigint
	tokens: Map<string, bigint>
	attoWeth: bigint
}

export type ExecutionCandidate = {
	capitalAtRiskAttoWeth: bigint
	hedgeFee: (typeof STANDARD_UNISWAP_FEES)[number]
	hedgePool: Address
	hedgeVenue: Venue
	opportunity: EvaluatedOpportunitySnapshot
	pool: Pool
	projectedGasCostAttoWeth: bigint
	quote: ArbitrageQuote
	report: OpenOracleStatePreimage
	marketConsensus?: MarketConsensusEstimate | undefined
}

type EvaluatedOpportunity = {
	candidate: ExecutionCandidate | undefined
	dexObservations: readonly MarketConsensusObservation[]
	opportunity: EvaluatedOpportunitySnapshot
}

/** A report inside its settlement window that inspection declined before pricing; `candidate: undefined` discriminates it from an evaluated report. */
export type SkippedReport = {
	candidate: undefined
	dexObservations: readonly MarketConsensusObservation[]
	opportunity: SkippedOpportunitySnapshot
}

export type ReportInspection = EvaluatedOpportunity | SkippedReport

export type ReadClient = PublicClient<Transport, Chain>
export type WriteClient = WalletClient<Transport, Chain, Account>
export type RecoveryConfiguration = Pick<Configuration, 'connectivity' | 'executor' | 'openOracle' | 'quorumRpcUrls'> & {
	network: Pick<Configuration['network'], 'weth'>
	submission: Pick<Configuration['submission'], 'mode'>
}
