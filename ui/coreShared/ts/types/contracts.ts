import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import type { ReputationTokenMetadata } from './reputation.js'
import type { UniverseLineageStep } from '../lib/universeLineage.js'
import type { WriteClient as ClientsWriteClient } from '../wallet/clients.js'
export type { ReadClient, WriteClient } from '../wallet/clients.js'

type ZoltarDeploymentStepId = 'proxyDeployer' | 'deploymentStatusOracle' | 'reputationToken' | 'multicall3' | 'uniformPriceDualCapBatchAuctionFactory' | 'securityPoolUtils' | 'openOracle' | 'zoltarQuestionData' | 'zoltar' | 'shareTokenFactory' | 'openOraclePriceCoordinatorFactory'

export type DeploymentStepId = ZoltarDeploymentStepId | 'securityPoolForker' | 'securityPoolOperationsDelegate' | 'escalationGameClaimDelegate' | 'escalationGameFactory' | 'securityPoolFactory'
export type MarketType = 'binary' | 'categorical' | 'scalar'

export type ReportingOutcomeKey = 'invalid' | 'yes' | 'no'
export type ForkOutcomeKey = ReportingOutcomeKey | 'none'
export type SecurityPoolSystemState = 'operational' | 'poolForked' | 'forkMigration' | 'forkTruthAuction'

export type QuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

export type ZoltarChildUniverseSummary = {
	exists: boolean
	forkTime: bigint
	outcomeIndex: bigint
	outcomeLabel: string
	parentUniverseId: bigint
	reputationToken: Address
	universeId: bigint
} & ReputationTokenMetadata

export type ZoltarUniverseSummary = {
	/** False for bounded overview reads that omit ancestry, fork question details, and children. */
	relatedUniversesLoaded?: boolean
	childUniverses: ZoltarChildUniverseSummary[]
	forkBurnDivisor?: bigint
	forkThresholdAttoRep: bigint
	forkQuestionDetails: MarketDetails | undefined
	forkTime: bigint
	forkingOutcomeIndex: bigint
	hasForked: boolean
	/** Genesis-first ancestry naming this universe by the fork outcomes that created it. */
	lineage?: readonly UniverseLineageStep[] | undefined
	parentUniverseId: bigint
	reputationToken: Address
	totalTheoreticalSupplyAttoRep: bigint
	universeId: bigint
	zoltarAddress?: Address
} & ReputationTokenMetadata

export type DeploymentStep = {
	id: DeploymentStepId
	label: string
	address: Address
	dependencies: DeploymentStepId[]
	deploy: (client: ClientsWriteClient) => Promise<Hash>
	expectedRuntimeCodeHash?: Hash
	trustedSimulationCodePresence?: true
}

export type DeploymentStatus = DeploymentStep & {
	deployed: boolean
}

export type DeploymentStatusSnapshot = {
	applicationDeploymentComplete: boolean
	deploymentStatuses: DeploymentStatus[]
}

type ActionResult = { hash: Hash }

export type MarketCreationResult = {
	questionId: string
	createQuestionHash: Hash
	marketType: MarketType
}

export type ZoltarForkActionResult = ActionResult & {
	action: 'approveForkRep' | 'forkZoltar'
	questionId: string
	universeId: bigint
}

export type ZoltarChildUniverseActionResult = ActionResult & {
	action: 'createChildUniverse'
	outcomeIndex: bigint
	universeId: bigint
}

export type ZoltarMigrationActionResult = ActionResult & {
	action: 'splitMigrationRep'
	amountAttoRep: bigint
	outcomeIndexes: bigint[]
	universeId: bigint
}

export type MarketDetails = QuestionData & {
	createdAt: bigint
	exists: boolean
	marketType: MarketType
	outcomeLabels: string[]
	questionId: string
}

export type MarketDetailsPage = {
	pageIndex: number
	pageSize: number
	questionCount: bigint
	questions: MarketDetails[]
}
