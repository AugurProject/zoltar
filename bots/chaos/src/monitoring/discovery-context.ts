import { MAXIMUM_DISCOVERY_AGGREGATE_ITEMS } from '../config/settings.ts'
import { type AuctionBidSnapshot, type AuctionRefundSnapshot, type ChildRepSplitProgressSnapshot, type EcosystemDeployments, type EscalationDepositSnapshot, type MigrationRepSplitProgressSnapshot, type OracleGameSnapshot } from '../operations/types.ts'
import { type ChaosReadClient } from './discovery-client.ts'
import { type CanonicalImmutableTopologyCache, IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES } from './topology-cache.ts'
import { type Address, type Hash } from '@zoltar/bot-shared/ethereum'

export const DISCOVERY_AGGREGATE_ITEM_LIMIT = MAXIMUM_DISCOVERY_AGGREGATE_ITEMS

// Zoltar persists and emits every non-empty label in one createQuestion
// transaction. These ceilings are far above a practical transaction-sized
// domain, but still make a hostile endpoint's pagination and memory finite.
const DEFAULT_MAXIMUM_OUTCOME_LABELS_PER_QUESTION = 4_096

const DEFAULT_MAXIMUM_OUTCOME_LABEL_UTF8_BYTES_PER_QUESTION = IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES

export interface DiscoveryLimits {
	maxOutcomeLabelUtf8BytesPerQuestion: number
	maxOutcomeLabelsPerQuestion: number
	maxQuestions: number
	maxUniverses: number
	maxPools: number
	maxVaultsPerPool: number
	maxStagedOperationsPerPool: number
}

export interface EcosystemDiscoveryContext {
	discoverGenesisDeployment?: boolean
	client: ChaosReadClient
	deployments: EcosystemDeployments
	wallet: Address | undefined
	anchorBlockNumber: bigint
	expectedAnchorBaseFeePerGas?: bigint
	expectedAnchorHash?: Hash
	limits?: Partial<DiscoveryLimits>
	indexedReports?: readonly OracleGameSnapshot[]
	indexedAuctionBids?: Readonly<Record<string, readonly AuctionBidSnapshot[]>>
	indexedAuctionRefunds?: Readonly<Record<string, Readonly<AuctionRefundSnapshot>>>
	indexedChildRepSplits?: readonly ChildRepSplitProgressSnapshot[]
	indexedEscalationDeposits?: readonly EscalationDepositSnapshot[]
	indexedMigrationRepSplits?: readonly MigrationRepSplitProgressSnapshot[]
	tokenSymbols?: Readonly<Record<string, string>>
	topologyCache?: CanonicalImmutableTopologyCache
	recordTopologyCache?: (cache: CanonicalImmutableTopologyCache, changed: boolean) => void
}

const DEFAULT_LIMITS: DiscoveryLimits = {
	maxOutcomeLabelUtf8BytesPerQuestion: DEFAULT_MAXIMUM_OUTCOME_LABEL_UTF8_BYTES_PER_QUESTION,
	maxOutcomeLabelsPerQuestion: DEFAULT_MAXIMUM_OUTCOME_LABELS_PER_QUESTION,
	maxPools: 100,
	maxQuestions: 100,
	maxStagedOperationsPerPool: 100,
	maxUniverses: 100,
	maxVaultsPerPool: 100,
}

export function limitsWithDefaults(configured?: Partial<DiscoveryLimits>): DiscoveryLimits {
	return {
		maxOutcomeLabelUtf8BytesPerQuestion: configured?.maxOutcomeLabelUtf8BytesPerQuestion ?? DEFAULT_LIMITS.maxOutcomeLabelUtf8BytesPerQuestion,
		maxOutcomeLabelsPerQuestion: configured?.maxOutcomeLabelsPerQuestion ?? DEFAULT_LIMITS.maxOutcomeLabelsPerQuestion,
		maxPools: configured?.maxPools ?? DEFAULT_LIMITS.maxPools,
		maxQuestions: configured?.maxQuestions ?? DEFAULT_LIMITS.maxQuestions,
		maxStagedOperationsPerPool: configured?.maxStagedOperationsPerPool ?? DEFAULT_LIMITS.maxStagedOperationsPerPool,
		maxUniverses: configured?.maxUniverses ?? DEFAULT_LIMITS.maxUniverses,
		maxVaultsPerPool: configured?.maxVaultsPerPool ?? DEFAULT_LIMITS.maxVaultsPerPool,
	}
}

export function requireAggregateDiscoveryEnvelope(limits: DiscoveryLimits) {
	for (const [label, value] of [
		['maxOutcomeLabelsPerQuestion', limits.maxOutcomeLabelsPerQuestion],
		['maxPools', limits.maxPools],
		['maxQuestions', limits.maxQuestions],
		['maxStagedOperationsPerPool', limits.maxStagedOperationsPerPool],
		['maxUniverses', limits.maxUniverses],
		['maxVaultsPerPool', limits.maxVaultsPerPool],
	] as const) {
		if (value > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`${label} exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
	}
	if (limits.maxOutcomeLabelUtf8BytesPerQuestion > IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES) {
		throw new Error(`maxOutcomeLabelUtf8BytesPerQuestion exceeds the ${IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES.toString()}-byte immutable-topology safety envelope`)
	}
	if (limits.maxPools * limits.maxUniverses > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`maxPools × maxUniverses exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
	if (limits.maxPools * limits.maxVaultsPerPool > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`maxPools × maxVaultsPerPool exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
	if (limits.maxPools * limits.maxStagedOperationsPerPool > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`maxPools × maxStagedOperationsPerPool exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
}
