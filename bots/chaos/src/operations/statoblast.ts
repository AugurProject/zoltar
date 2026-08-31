import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { maximumFeePerGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { auctionAbi, coordinatorAbi, erc20Abi, escalationGameAbi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi } from '../contracts/abi.ts'
import { allowance, amount, cappedSpend, choose, disabled, eligible, encodePreflightCall, encodeStep, erc1155WalletDebit, erc20AllowanceEvidence, erc20WalletDebit, eventEvidence, eventTopic, mixSeed, ONE_TOKEN, optionAmount, planBase, securityPoolVaultRepDebit, tokenInventory } from './planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationEvidence, OperationPlan, OperationWalletAssetDebit, PlanningOptions, PoolSnapshot } from './types.ts'
import { validForkOutcomeRoutes } from './fork-outcomes.ts'
import { assertOracleRequestFundingEnvelope, isOracleRequestFundingError, oracleRequestFundingEnvelope, oracleRequestSettlementCollateralCeiling, type OracleRequestFundingBounds } from './oracle-request-funding.ts'
import { canCreateCompleteSet, sharesToProjectedEth } from './pool-economics.ts'
import { timestampDeadlineHasRequiredSafety } from './timing.ts'
import { topologyMutationCapacityBlocker, vaultRegistrationCapacityBlocker } from './topology-capacity.ts'

const BINARY_OUTCOME_NONE = 3
const MIGRATION_TIME_SECONDS = 8n * 7n * 24n * 60n * 60n
const LIFECYCLE_BATCH_LIMIT = 16
const ORACLE_PRICE_VALIDITY_SECONDS = 5n * 60n
const STAGED_WITHDRAWAL_VALIDITY_SECONDS = 5n * 60n
const CARRY_DEPOSIT_CONSUMED_SIGNATURE = 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'
const CARRY_DEPOSIT_CONSUMED_ABI = 'event CarryDepositConsumed(uint256 indexed parentDepositIndex, uint256 indexed sourceNodeId, address indexed depositor, uint8 outcome, uint256 attoRepAmount, uint8 reason, uint256 resultingUnresolvedTotalAttoRep, bytes32 resultingNullifierRoot, bytes32 resultingCarryRoot)'
const CLAIM_DEPOSIT_SIGNATURE = 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)'
const CLAIM_DEPOSIT_ABI = 'event ClaimDeposit(address indexed depositor, uint8 indexed outcome, uint256 indexed parentDepositIndex, uint256 originalDepositAmountAttoRep, uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep, bool transferredRep)'
const CHILD_REP_SPLIT_SIGNATURE = 'ChildRepSplit(address,uint256,uint256,uint256)'
const CHILD_REP_SPLIT_ABI = 'event ChildRepSplit(address indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep)'
const VAULT_MIGRATION_SIGNATURE = 'VaultMigrationCheckpoint(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)'
const VAULT_MIGRATION_ABI =
	'event VaultMigrationCheckpoint(address indexed parentPool, address indexed childPool, address indexed vault, uint256 outcomeIndex, uint256 migratedRepDeltaAttoRep, uint256 resultingChildMigratedRepTotalAttoRep, uint256 resultingParentRepBackingUnits, uint256 resultingParentCapacityOwnershipAttoRep, uint256 resultingChildRepBackingUnits, uint256 resultingChildCapacityOwnershipAttoRep, uint256 resultingParentTotalRepBackingUnits, uint256 resultingChildTotalRepBackingUnits, uint256 resultingParentTotalCapacityOwnershipAttoRep, uint256 resultingChildTotalCapacityOwnershipAttoRep, uint256 settlementCollateralTransferredAttoEth, uint256 cumulativeSettlementCollateralTransferredAttoEth)'
const shareTokenId = (universeId: string, outcome: number) => (amount(universeId) << 8n) | BigInt(outcome)
const compareBigInts = (left: bigint, right: bigint) => {
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

const compareDecimalStrings = (left: string, right: string) => compareBigInts(BigInt(left), BigInt(right))
const compareAuctionBids = (left: EcosystemSnapshot['auctions'][number]['bids'][number], right: EcosystemSnapshot['auctions'][number]['bids'][number]) => {
	const tickOrder = compareDecimalStrings(left.tick, right.tick)
	return tickOrder === 0 ? compareDecimalStrings(left.index, right.index) : tickOrder
}
function lifecycleBatches<T>(values: readonly T[]) {
	return Array.from({ length: Math.ceil(values.length / LIFECYCLE_BATCH_LIMIT) }, (_, index) => values.slice(index * LIFECYCLE_BATCH_LIMIT, (index + 1) * LIFECYCLE_BATCH_LIMIT))
}
const walletShares = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
const forkOutcomesForPool = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => {
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	if (universe === undefined || universe.forkTime === '0') return []
	return validForkOutcomeRoutes(
		snapshot.questions.find(question => question.id === universe.forkQuestionId),
		universe.knownChildOutcomes,
	)
}
const childPoolForOutcome = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string) => snapshot.pools.find(child => child.parent.toLowerCase() === pool.address.toLowerCase() && child.forkOutcomeIndex === outcome)
const childUniverseForOutcome = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string) => snapshot.universes.find(universe => universe.parentUniverseId === pool.universeId && universe.forkingOutcomeIndex === outcome)

function childRouteTopologyCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	if (childPoolForOutcome(snapshot, pool, outcome) !== undefined) return undefined
	return topologyMutationCapacityBlocker(snapshot, options, {
		additionalPools: 1,
		additionalUniverses: childUniverseForOutcome(snapshot, pool, outcome) === undefined ? 1 : 0,
		label,
	})
}

function childUniverseTopologyCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	if (childUniverseForOutcome(snapshot, pool, outcome) !== undefined) return undefined
	return topologyMutationCapacityBlocker(snapshot, options, {
		additionalPools: 0,
		additionalUniverses: 1,
		label,
	})
}
const operationalPools = (snapshot: EcosystemSnapshot) => snapshot.pools.filter(pool => pool.systemState === 0 && !pool.awaitingForkContinuation && pool.questionOutcome === BINARY_OUTCOME_NONE && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0')
const walletVault = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => pool.vaults.find(vault => vault.address.toLowerCase() === snapshot.wallet.address.toLowerCase())
const canDeployOriginPool = (universe: EcosystemSnapshot['universes'][number]) => universe.forkTime === '0' && amount(universe.nonDecisionThresholdAttoRep) > amount(universe.initialEscalationDepositAttoRep)

function safeOraclePriceDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, prerequisiteCount = 0) {
	if (!pool.oraclePriceValid) return undefined
	const deadline = amount(pool.lastOracleSettlementTimestamp) + ORACLE_PRICE_VALIDITY_SECONDS
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options, prerequisiteCount) ? deadline : undefined
}

function decodedVaultMigrationEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot, field: 'outcomeIndex' | 'resultingParentRepBackingUnits', expected: string, child?: PoolSnapshot): OperationEvidence {
	return {
		abi: VAULT_MIGRATION_ABI,
		emitter: snapshot.deployments.securityPoolForker,
		equals: expected,
		field,
		indexed: { ...(child === undefined ? {} : { childPool: child.address }), parentPool: pool.address, vault: snapshot.wallet.address },
		kind: 'decoded-event-field',
		signature: VAULT_MIGRATION_SIGNATURE,
		topic0: eventTopic(VAULT_MIGRATION_SIGNATURE),
	}
}

function decodedChildRepSplitEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string): OperationEvidence {
	return {
		abi: CHILD_REP_SPLIT_ABI,
		canonicalLifecycleConfirmation: true,
		emitter: snapshot.deployments.securityPoolForker,
		equals: pool.forkRepMigrationTargetAttoRep,
		field: 'childPoolRepSplitAttoRep',
		indexed: { outcomeIndex: outcome, parent: pool.address },
		kind: 'decoded-event-field',
		signature: CHILD_REP_SPLIT_SIGNATURE,
		topic0: eventTopic(CHILD_REP_SPLIT_SIGNATURE),
	}
}

function feeCheckpointDue(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	const target = feeCheckpointTarget(snapshot, pool)
	return target !== undefined && amount(pool.lastUpdatedFeeAccumulator) < target
}

function feeCheckpointTarget(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	const question = snapshot.questions.find(candidate => candidate.id === pool.questionId)
	if (universe === undefined || question === undefined) return undefined
	const feeEnd = amount(universe.forkTime) === 0n ? amount(question.endTime) : amount(universe.forkTime)
	const now = amount(snapshot.anchor.timestamp)
	return now < feeEnd ? now : feeEnd
}

function poolAccountingCurrentEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot): OperationEvidence {
	const target = feeCheckpointTarget(snapshot, pool)
	if (target === undefined) throw new Error(`Pool ${pool.address} is missing its fee checkpoint boundary`)
	return {
		abi: 'function lastUpdatedFeeAccumulator() view returns (uint256)',
		args: [],
		contract: pool.address,
		expected: target.toString(),
		functionName: 'lastUpdatedFeeAccumulator',
		kind: 'storage-postcondition',
		relation: 'at-least',
	}
}

function vaultFeeAccountingEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot): OperationEvidence[] {
	// `securityVaults(address)` exposes the target fee index only inside a tuple, while durable
	// evidence reads one scalar. A successful exact call guarantees that the vault is synchronized
	// to the pool index before returning; these monotonic pool targets prove which index and
	// checkpoint boundary the call reached even when another keeper made the call a no-op.
	return [
		{
			abi: 'function feeIndex() view returns (uint256)',
			args: [],
			contract: pool.address,
			expected: pool.feeIndex,
			functionName: 'feeIndex',
			kind: 'storage-postcondition',
			relation: 'at-least',
		},
		poolAccountingCurrentEvidence(snapshot, pool),
	]
}

function sharesToEth(pool: PoolSnapshot, attoShares: bigint) {
	return sharesToProjectedEth(pool, attoShares)
}

function escalationWithdrawalSafe(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	if (pool.escalationNonDecisionState !== 0) return false
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	if (universe === undefined) return false
	const forkTime = amount(universe.forkTime)
	return forkTime === 0n || forkTime >= amount(pool.escalationGameEndTime) || pool.escalationHasReachedNonDecision
}

function ethSpend(snapshot: EcosystemSnapshot, options: PlanningOptions, salt: string, minimum = 1n) {
	return cappedSpend(amount(snapshot.wallet.ethBalanceAttoEth), optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n), optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n), mixSeed(options.seed, salt), minimum)
}

function repSpend(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, salt: string, minimum = 1n) {
	const token = tokenInventory(snapshot, pool.repToken)
	return cappedSpend(token === undefined ? 0n : amount(token.balance), optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN), optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN), mixSeed(options.seed, salt), minimum)
}

function approvePool(snapshot: EcosystemSnapshot, pool: PoolSnapshot, required: bigint) {
	const token = tokenInventory(snapshot, pool.repToken)
	if (allowance(token, pool.address) >= required) return []
	return [poolApprovalStep(snapshot, pool.repToken, pool.address, required)]
}

function poolApprovalStep(snapshot: EcosystemSnapshot, token: `0x${string}`, pool: `0x${string}`, required: bigint, id = 'approve-rep', label = 'Approve REP for security pool') {
	return encodeStep({ abi: erc20Abi, args: [pool, required], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, pool, required)], functionName: 'approve', id, label, to: token })
}

function requiredVaultMetadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || value.length === 0) throw new Error(`Vault continuation metadata ${key} is missing`)
	return value
}

function requiredVaultMetadataAmount(metadata: OperationPlan['metadata'], key: string) {
	const value = requiredVaultMetadataString(metadata, key)
	if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`Vault continuation metadata ${key} is not canonical`)
	return BigInt(value)
}

function exactPreviousPoolApproval(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, pool: `0x${string}`, required: bigint) {
	const previous = context.previousPlan.steps.find(step => step.id === 'approve-rep')
	if (previous === undefined) return undefined
	const expected = poolApprovalStep(snapshot, token, pool, required)
	return previous.to.toLowerCase() === expected.to.toLowerCase() && previous.data === expected.data ? previous : undefined
}

function poolApprovalPrepared(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, pool: `0x${string}`, required: bigint) {
	const previous = exactPreviousPoolApproval(snapshot, context, token, pool, required)
	if (context.previousPlan.steps.some(step => step.id === 'approve-rep') && previous === undefined) return false
	if (previous !== undefined && context.confirmedStepIds.includes(previous.id)) return allowance(tokenInventory(snapshot, token), pool) === required
	if (previous === undefined) return allowance(tokenInventory(snapshot, token), pool) >= required
	return true
}

function poolCleanupPlan(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, pool: `0x${string}`, required: bigint) {
	const previous = exactPreviousPoolApproval(snapshot, context, token, pool, required)
	if (previous === undefined || !context.confirmedStepIds.includes(previous.id)) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'statoblast',
		label: 'Clean up vault deposit approval',
		metadata: context.previousPlan.metadata,
		postconditions: ['The confirmed workflow-created REP allowance for the pool is zero'],
		risk: 'medium',
		snapshot,
		steps: [poolApprovalStep(snapshot, token, pool, 0n, 'revoke-rep', 'Revoke workflow-created REP approval for pool')],
	})
}

function approveCoordinatorToken(snapshot: EcosystemSnapshot, coordinator: `0x${string}`, tokenAddress: `0x${string}`, required: bigint, id: string, label: string) {
	return encodeStep({ abi: erc20Abi, args: [coordinator, required], evidence: [erc20AllowanceEvidence(tokenAddress, snapshot.wallet.address, coordinator, required)], functionName: 'approve', id, label, to: tokenAddress })
}

function oracleRequestStagingParameters(pool: PoolSnapshot) {
	const minimumWeth = amount(pool.minimumToken1ReportAttoEth)
	return {
		initialWethAttoEth: minimumWeth > 0n ? minimumWeth : 1n,
		price: amount(pool.lastRepPerEthPrice) > 0n ? amount(pool.lastRepPerEthPrice) : ONE_TOKEN,
	}
}

type PreparedOracleRequest = {
	envelope: OracleRequestFundingBounds
	price: bigint
	settlementCollateralCeilingAttoEth: bigint
}

function maximumWorkflowGasBudget(options: PlanningOptions, transactionCount: number) {
	if (!Number.isSafeInteger(transactionCount) || transactionCount < 0) throw new Error('Oracle workflow transaction count is invalid')
	return amount(options.maximumGasCostAttoEth ?? '0') * BigInt(transactionCount)
}

function amountAfterReserve(balance: bigint, reserve: bigint) {
	return balance > reserve ? balance - reserve : 0n
}

function oracleRequestInventoryIsFunded(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, prepared: PreparedOracleRequest, transactionCount: number) {
	const weth = tokenInventory(snapshot, snapshot.deployments.weth)
	const rep = tokenInventory(snapshot, pool.repToken)
	if (weth === undefined || rep === undefined) return false
	const initialWethAttoEth = amount(prepared.envelope.maximumInitialAttoWeth)
	const initialRepAttoRep = amount(prepared.envelope.maximumInitialAttoRep)
	const bountyAttoEth = amount(prepared.envelope.maximumRequestPriceCostAttoEth)
	const minimumEthReserve = optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n)
	const minimumRepReserve = optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
	return amount(weth.balance) >= initialWethAttoEth && amount(rep.balance) >= initialRepAttoRep + minimumRepReserve && amount(snapshot.wallet.ethBalanceAttoEth) >= minimumEthReserve + bountyAttoEth + maximumWorkflowGasBudget(options, transactionCount)
}

function oracleRequestPreparation(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions): PreparedOracleRequest | undefined {
	try {
		const weth = tokenInventory(snapshot, snapshot.deployments.weth)
		const rep = tokenInventory(snapshot, pool.repToken)
		if (weth === undefined || rep === undefined) return undefined
		const maximumEthPrincipal = optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
		const maximumRepPrincipal = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const nativeInventory = amountAfterReserve(amount(snapshot.wallet.ethBalanceAttoEth), optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n) + maximumWorkflowGasBudget(options, 5))
		const repInventory = amountAfterReserve(amount(rep.balance), optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN))
		const price = amount(pool.lastRepPerEthPrice) > 0n ? amount(pool.lastRepPerEthPrice) : ONE_TOKEN
		const envelopeParameters = {
			coordinator: pool.oracleRequestFunding,
			maximumEthPrincipalAttoEth: maximumEthPrincipal.toString(),
			maximumNativePrincipalAttoEth: (nativeInventory < maximumEthPrincipal ? nativeInventory : maximumEthPrincipal).toString(),
			maximumRepPrincipalAttoRep: (repInventory < maximumRepPrincipal ? repInventory : maximumRepPrincipal).toString(),
			maximumWethPrincipalAttoEth: (amount(weth.balance) < maximumEthPrincipal ? amount(weth.balance) : maximumEthPrincipal).toString(),
			proposedRepPerEthPrice: price.toString(),
			settlementCollateralCeilingAttoEth: pool.settlementCollateralAttoEth,
		}
		const currentEnvelope = oracleRequestFundingEnvelope(envelopeParameters)
		const settlementCollateralCeilingAttoEth = amount(oracleRequestSettlementCollateralCeiling({ coordinator: pool.oracleRequestFunding, envelope: currentEnvelope }))
		const envelope = oracleRequestFundingEnvelope({ ...envelopeParameters, settlementCollateralCeilingAttoEth: settlementCollateralCeilingAttoEth.toString() })
		if (maximumFeePerGas(amount(snapshot.anchor.baseFeePerGas)) > amount(envelope.maximumBaseFeePerGas)) return undefined
		const prepared = { envelope, price, settlementCollateralCeilingAttoEth }
		// Two exact approvals, one terminal request, and two possible cleanup approvals.
		return oracleRequestInventoryIsFunded(snapshot, pool, options, prepared, 5) ? prepared : undefined
	} catch (error) {
		if (!isOracleRequestFundingError(error)) throw error
		// One malformed or unaffordable pool must not abort the ecosystem catalog.
		return undefined
	}
}

function exactTokenTransferToCoordinatorEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, coordinator: `0x${string}`, expected: bigint): OperationEvidence {
	return {
		abi: 'event Transfer(address indexed from, address indexed to, uint256 value)',
		emitter: token,
		equals: expected.toString(),
		field: 'value',
		indexed: { from: snapshot.wallet.address, to: coordinator },
		kind: 'decoded-event-field',
		signature: 'Transfer(address,address,uint256)',
		topic0: eventTopic('Transfer(address,address,uint256)'),
	}
}

function decodedStagedSuccess(coordinator: `0x${string}`): OperationEvidence {
	const signature = 'ExecutedStagedOperation(uint256,uint8,bool,string)'
	return {
		abi: 'event ExecutedStagedOperation(uint256 indexed operationId, uint8 operation, bool success, string errorMessage)',
		emitter: coordinator,
		equals: true,
		field: 'success',
		indexed: {},
		kind: 'decoded-event-field',
		signature,
		topic0: eventTopic(signature),
	}
}

function stagedDownstreamPreflight(pool: PoolSnapshot, staged: EcosystemSnapshot['stagedOperations'][number]) {
	if (staged.operation === 1) {
		return encodePreflightCall({
			abi: securityPoolAbi,
			args: [staged.operator, amount(staged.amount)],
			caller: staged.coordinator,
			expectedResult: staged.executionExpectedResult,
			functionName: 'withdrawRepFromVault',
			label: `withdraw staged REP ${staged.id}`,
			to: pool.address,
		})
	}
	return undefined
}

function poolDeploymentCapacityBlocker(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return topologyMutationCapacityBlocker(snapshot, options, { additionalPools: 1, additionalUniverses: 0, label: 'Pool deployment' })
}

const deployPool: OperationDefinition = {
	buildPlan(snapshot, options) {
		if (poolDeploymentCapacityBlocker(snapshot, options) !== undefined) return undefined
		const deployed = new Set(snapshot.pools.map(pool => `${pool.universeId}:${pool.questionId}`))
		const binaryQuestions = snapshot.questions.filter(question => question.kind === 'binary')
		const candidates = snapshot.universes.flatMap(universe => binaryQuestions.map(question => ({ question, universe }))).filter(candidate => canDeployOriginPool(candidate.universe) && !deployed.has(`${candidate.universe.id}:${candidate.question.id}`))
		const candidate = choose(candidates, mixSeed(options.seed, deployPool.id))
		if (candidate === undefined) return undefined
		const multiplier = 11_000n + BigInt(mixSeed(options.seed, 'pool-multiplier') % 9_001)
		const priorityFee = 1n + BigInt(mixSeed(options.seed, 'pool-priority-fee') % 1_000_000)
		return planBase({
			definitionId: deployPool.id,
			ecosystem: 'statoblast',
			label: deployPool.label,
			metadata: { questionId: candidate.question.id, universeId: candidate.universe.id },
			postconditions: ['The canonical factory registers a new origin security pool'],
			risk: 'medium',
			snapshot,
			steps: [
				encodeStep({
					abi: securityPoolFactoryAbi,
					args: [BigInt(candidate.universe.id), BigInt(candidate.question.id), multiplier, priorityFee],
					evidence: [eventEvidence(snapshot.deployments.securityPoolFactory, 'DeploySecurityPool(address,address,address,address,address,uint248,uint256,uint256,uint256,uint256,uint256)')],
					functionName: 'deployOriginSecurityPool',
					id: 'deploy-origin-pool',
					label: 'Deploy origin security pool',
					to: snapshot.deployments.securityPoolFactory,
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'SecurityPoolFactory',
	description: 'Deploys a canonical pool for an unrepresented binary question and active universe.',
	discoveryInputs: ['binary questions', 'unforked universes', 'factory deployments', 'non-decision threshold and theoretical REP supply'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const deployed = new Set(snapshot.pools.map(pool => `${pool.universeId}:${pool.questionId}`))
		const found = snapshot.universes.some(universe => canDeployOriginPool(universe) && snapshot.questions.some(question => question.kind === 'binary' && !deployed.has(`${universe.id}:${question.id}`)))
		return eligible(poolDeploymentCapacityBlocker(snapshot, options), found ? undefined : 'No undeployed binary question/universe combination')
	},
	id: 'statoblast.pool.deploy',
	label: 'Deploy security pool',
	method: 'deployOriginSecurityPool',
	risk: 'medium',
}

function checkpointDefinition(kind: 'collateral' | 'retention'): OperationDefinition {
	const id = `statoblast.pool.checkpoint-${kind}`
	const method = kind === 'collateral' ? 'updateSettlementCollateral' : 'updateRetentionRate'
	return {
		buildPlan(snapshot, options) {
			const pool = choose(
				snapshot.pools.filter(candidate => feeCheckpointDue(snapshot, candidate) && (kind === 'collateral' || candidate.systemState === 0)),
				mixSeed(options.seed, id),
			)
			if (pool === undefined) return undefined
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: `Checkpoint pool ${kind}`,
				metadata: { pool: pool.address },
				postconditions: ['Pool accounting is current at the receipt block'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: securityPoolAbi, evidence: [poolAccountingCurrentEvidence(snapshot, pool)], functionName: method, id: method, label: `Update ${kind}`, to: pool.address })],
			})
		},
		classification: 'selectable',
		contract: 'SecurityPool',
		description: `Permissionlessly checkpoints ${kind} accounting.`,
		discoveryInputs: ['security pools'],
		ecosystem: 'statoblast',
		evaluate: snapshot => eligible(snapshot.pools.some(pool => feeCheckpointDue(snapshot, pool) && (kind === 'collateral' || pool.systemState === 0)) ? undefined : 'No eligible pool has an uncheckpointed accounting interval'),
		id,
		label: `Checkpoint ${kind}`,
		method,
		risk: 'low',
	}
}

function walletVaultRegistrationCapacityBlocker(pool: PoolSnapshot, options: PlanningOptions, label: string) {
	return vaultRegistrationCapacityBlocker({ canonicalVaultCount: pool.canonicalVaultCount, registered: pool.walletVaultRegistered }, options, label)
}

function walletChildRouteCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	const topologyBlocker = childRouteTopologyCapacityBlocker(snapshot, pool, outcome, options, `${label} topology`)
	if (topologyBlocker !== undefined) return topologyBlocker
	const child = childPoolForOutcome(snapshot, pool, outcome)
	return child === undefined ? undefined : walletVaultRegistrationCapacityBlocker(child, options, `${label} vault registration`)
}

function walletVaultMigrationRouteCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	const sourceBlocker = walletVaultRegistrationCapacityBlocker(pool, options, `${label} source-vault registration`)
	return sourceBlocker ?? walletChildRouteCapacityBlocker(snapshot, pool, outcome, options, `${label} target-child`)
}

function vaultDepositCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return operationalPools(snapshot).filter(pool => repSpend(snapshot, pool, options, depositVault.id, amount(pool.minimumSafeWalletVaultDepositAttoRep)) >= amount(pool.minimumSafeWalletVaultDepositAttoRep) && walletVaultRegistrationCapacityBlocker(pool, options, 'Wallet vault deposit registration') === undefined)
}

const depositVault: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(vaultDepositCandidates(snapshot, options), mixSeed(options.seed, depositVault.id))
		if (pool === undefined) return undefined
		const spend = repSpend(snapshot, pool, options, depositVault.id, amount(pool.minimumSafeWalletVaultDepositAttoRep))
		const steps = approvePool(snapshot, pool, spend)
		steps.push(
			encodeStep({
				abi: securityPoolAbi,
				args: [spend, 15_000n],
				evidence: [eventEvidence(pool.address, 'RepDepositedToVault(address,uint256,uint256,uint256)')],
				functionName: 'depositRepToVault',
				id: 'deposit-rep',
				label: 'Deposit REP into own vault',
				to: pool.address,
				walletAssetDebits: [erc20WalletDebit(pool.repToken, spend, 'rep')],
			}),
		)
		return planBase({
			definitionId: depositVault.id,
			ecosystem: 'statoblast',
			label: depositVault.label,
			maximumCleanupTransactionCount: steps.length > 1 ? 1 : undefined,
			metadata: { amountAttoRep: spend.toString(), pool: pool.address, repToken: pool.repToken },
			postconditions: ['Wallet vault REP backing units increase'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const spend = requiredVaultMetadataAmount(context.previousPlan.metadata, 'amountAttoRep')
		const poolAddress = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'pool'))
		const repToken = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'repToken'))
		const cleanup = () => poolCleanupPlan(snapshot, context, repToken, poolAddress, spend)
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const pool = operationalPools(snapshot).find(candidate => candidate.address.toLowerCase() === poolAddress.toLowerCase())
		const inventory = tokenInventory(snapshot, repToken)
		const safe =
			pool !== undefined &&
			pool.repToken.toLowerCase() === repToken.toLowerCase() &&
			walletVaultRegistrationCapacityBlocker(pool, options, 'Wallet vault deposit registration') === undefined &&
			spend > 0n &&
			spend >= amount(pool.minimumSafeWalletVaultDepositAttoRep) &&
			spend <= optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) &&
			inventory !== undefined &&
			amount(inventory.balance) >= spend + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) &&
			poolApprovalPrepared(snapshot, context, repToken, poolAddress, spend)
		if (!safe) return cleanup()
		const previousApproval = exactPreviousPoolApproval(snapshot, context, repToken, poolAddress, spend)
		const steps = previousApproval !== undefined && !context.confirmedStepIds.includes(previousApproval.id) ? [poolApprovalStep(snapshot, repToken, poolAddress, spend)] : []
		steps.push(
			encodeStep({
				abi: securityPoolAbi,
				args: [spend, 15_000n],
				evidence: [eventEvidence(poolAddress, 'RepDepositedToVault(address,uint256,uint256,uint256)')],
				functionName: 'depositRepToVault',
				id: 'deposit-rep',
				label: 'Deposit REP into own vault',
				to: poolAddress,
				walletAssetDebits: [erc20WalletDebit(repToken, spend, 'rep')],
			}),
		)
		return planBase({
			definitionId: depositVault.id,
			ecosystem: 'statoblast',
			label: depositVault.label,
			maximumCleanupTransactionCount: previousApproval === undefined ? undefined : 1,
			metadata: context.previousPlan.metadata,
			postconditions: ['Wallet vault REP backing units increase'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'SecurityPool',
	description: 'Deposits a bounded REP amount into the wallet vault with a conservative health target.',
	discoveryInputs: ['pool lifecycle', 'post-transfer backing round-trip minimum', 'REP balance and allowance'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const affordable = operationalPools(snapshot).filter(pool => repSpend(snapshot, pool, options, depositVault.id, amount(pool.minimumSafeWalletVaultDepositAttoRep)) >= amount(pool.minimumSafeWalletVaultDepositAttoRep))
		const firstAffordable = affordable[0]
		const capacityBlocker = firstAffordable === undefined || affordable.some(pool => walletVaultRegistrationCapacityBlocker(pool, options, 'Wallet vault deposit registration') === undefined) ? undefined : walletVaultRegistrationCapacityBlocker(firstAffordable, options, 'Wallet vault deposit registration')
		return eligible(capacityBlocker, affordable.length > 0 ? undefined : 'No operational pool has an affordable round-trip-safe REP deposit')
	},
	id: 'statoblast.vault.deposit-rep',
	label: 'Deposit REP to vault',
	method: 'depositRepToVault',
	risk: 'medium',
}

function vaultActionDefinition(kind: 'update-fees' | 'redeem-fees' | 'redeem-rep'): OperationDefinition {
	let method = 'updateVaultFees'
	let actionLabel = 'Update vault fees'
	let postcondition = 'Vault fee index is current'
	if (kind === 'redeem-fees') {
		method = 'redeemFees'
		actionLabel = 'Redeem vault fees'
		postcondition = 'Vault fees are redeemed or were already redeemed by another keeper'
	} else if (kind === 'redeem-rep') {
		method = 'redeemRepFromVault'
		actionLabel = 'Redeem finalized vault REP'
		postcondition = 'Redeemable REP is returned to the wallet'
	}
	const id = `statoblast.vault.${kind}`
	return {
		buildPlan(snapshot, options) {
			const pool = choose(
				snapshot.pools.filter(candidate => {
					const vault = walletVault(snapshot, candidate)
					if (vault === undefined) return false
					if (kind === 'redeem-fees') return amount(vault.claimableFeesAttoEth) > 0n
					if (kind === 'redeem-rep') return amount(vault.repBackingAttoRep) > 0n && amount(vault.disputeStakedAttoRep) === 0n && candidate.questionOutcome !== BINARY_OUTCOME_NONE && candidate.systemState === 0
					return (amount(vault.repBackingUnits) > 0n || amount(vault.capacityOwnershipAttoRep) > 0n) && (feeCheckpointDue(snapshot, candidate) || amount(vault.feeIndex) < amount(candidate.feeIndex))
				}),
				mixSeed(options.seed, id),
			)
			if (pool === undefined) return undefined
			const vault = walletVault(snapshot, pool)
			if (vault === undefined) return undefined
			const evidence = kind === 'redeem-rep' ? [eventEvidence(pool.address, 'RepRedeemedFromVault(address,address,uint256,uint256,uint256)')] : vaultFeeAccountingEvidence(snapshot, pool)
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: actionLabel,
				metadata: { pool: pool.address, vault: snapshot.wallet.address },
				postconditions: [postcondition],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: securityPoolAbi, args: [snapshot.wallet.address], evidence, functionName: method, id: method, label: method, to: pool.address })],
			})
		},
		classification: 'selectable',
		contract: 'SecurityPool',
		description: `Runs the wallet's ${kind} vault path when it has an effect.`,
		discoveryInputs: ['wallet vault accounting', 'pool lifecycle'],
		ecosystem: 'statoblast',
		evaluate(snapshot) {
			const possible = snapshot.pools.some(pool => {
				const vault = walletVault(snapshot, pool)
				if (vault === undefined) return false
				if (kind === 'redeem-fees') return amount(vault.claimableFeesAttoEth) > 0n
				if (kind === 'redeem-rep') return amount(vault.repBackingAttoRep) > 0n && amount(vault.disputeStakedAttoRep) === 0n && pool.questionOutcome !== BINARY_OUTCOME_NONE && pool.systemState === 0
				return (amount(vault.repBackingUnits) > 0n || amount(vault.capacityOwnershipAttoRep) > 0n) && (feeCheckpointDue(snapshot, pool) || amount(vault.feeIndex) < amount(pool.feeIndex))
			})
			return eligible(possible ? undefined : 'No wallet vault has an eligible balance')
		},
		id,
		label: kind,
		method,
		risk: 'low',
	}
}

function completeSetDefinition(kind: 'create' | 'redeem' | 'winning'): OperationDefinition {
	let id = 'statoblast.complete-set.create'
	let method = 'createCompleteSet'
	let actionLabel = 'Create complete set'
	let signature = 'CompleteSetCreated(address,uint256,uint256,uint256,uint256)'
	if (kind === 'redeem') {
		id = 'statoblast.complete-set.redeem'
		method = 'redeemCompleteSet'
		actionLabel = 'Redeem complete set'
		signature = 'CompleteSetRedeemed(address,uint256,uint256,uint256,uint256)'
	} else if (kind === 'winning') {
		id = 'statoblast.shares.redeem-winning'
		method = 'redeemShares'
		actionLabel = 'Redeem winning shares'
		signature = 'SharesRedeemed(address,uint256,uint256,uint256,uint256)'
	}
	return {
		buildPlan(snapshot, options) {
			const candidates = snapshot.pools.filter(pool => {
				if (kind === 'create') return operationalPools(snapshot).includes(pool) && safeOraclePriceDeadline(snapshot, pool, options) !== undefined && canCreateCompleteSet(pool, ethSpend(snapshot, options, id))
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return false
				if (kind === 'redeem') {
					const complete = [shares.invalid, shares.yes, shares.no].map(balance => amount(balance)).reduce((minimum, balance) => (balance < minimum ? balance : minimum))
					return complete > 0n && sharesToEth(pool, complete) > 0n && pool.systemState === 0 && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0'
				}
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				return pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && winningBalance !== undefined && amount(winningBalance) > 0n && sharesToEth(pool, amount(winningBalance)) > 0n
			})
			const pool = choose(candidates, mixSeed(options.seed, id))
			if (pool === undefined) return undefined
			let spend = 0n
			if (kind === 'create') spend = ethSpend(snapshot, options, id)
			else if (kind === 'redeem') {
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return undefined
				spend = [amount(shares.invalid), amount(shares.yes), amount(shares.no)].reduce((minimum, value) => (value < minimum ? value : minimum))
			}
			const args = kind === 'redeem' ? [spend] : undefined
			const shares = walletShares(snapshot, pool)
			if (kind !== 'create' && shares === undefined) return undefined
			const oracleDeadline = kind === 'create' ? safeOraclePriceDeadline(snapshot, pool, options) : undefined
			if (kind === 'create' && oracleDeadline === undefined) return undefined
			let walletAssetDebits: OperationWalletAssetDebit[] = []
			if (kind === 'redeem') walletAssetDebits = [0, 1, 2].map(outcome => erc1155WalletDebit(pool.shareToken, shareTokenId(pool.universeId, outcome), spend))
			if (kind === 'winning' && shares !== undefined) {
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				if (winningBalance === undefined || amount(winningBalance) === 0n) return undefined
				walletAssetDebits = [erc1155WalletDebit(pool.shareToken, shareTokenId(pool.universeId, pool.questionOutcome), amount(winningBalance))]
			}
			return planBase({
				...(oracleDeadline === undefined ? {} : { deadlineTimestamp: oracleDeadline.toString() }),
				definitionId: id,
				ecosystem: 'statoblast',
				label: actionLabel,
				metadata: { amount: spend.toString(), pool: pool.address },
				postconditions: [kind === 'create' ? 'All three outcome share balances increase equally' : 'Pool collateral and wallet share balances decrease consistently'],
				risk: kind === 'create' ? 'medium' : 'low',
				snapshot,
				steps: [encodeStep({ abi: securityPoolAbi, args, evidence: [eventEvidence(pool.address, signature)], functionName: method, id: method, label: method, to: pool.address, value: kind === 'create' ? spend : undefined, walletAssetDebits })],
			})
		},
		classification: 'selectable',
		contract: 'SecurityPool',
		description: `Exercises the ${kind} complete-set/share workflow with wallet-owned inventory.`,
		discoveryInputs: ['share balances', 'pool lifecycle', 'wallet ETH'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			if (kind === 'create') {
				const spend = ethSpend(snapshot, options, id)
				return eligible(
					operationalPools(snapshot).some(pool => safeOraclePriceDeadline(snapshot, pool, options) !== undefined && canCreateCompleteSet(pool, spend)) ? undefined : 'No operational pool has a safely fresh price and minting capacity for the spend',
					spend === 0n ? 'No spendable ETH above reserve' : undefined,
				)
			}
			const possible = snapshot.pools.some(pool => {
				const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
				if (shares === undefined) return false
				if (kind === 'redeem') {
					const complete = [shares.invalid, shares.yes, shares.no].map(balance => amount(balance)).reduce((minimum, balance) => (balance < minimum ? balance : minimum))
					return pool.systemState === 0 && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0' && complete > 0n && sharesToEth(pool, complete) > 0n
				}
				const winningBalance = [shares.invalid, shares.yes, shares.no][pool.questionOutcome]
				return pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && winningBalance !== undefined && amount(winningBalance) > 0n && sharesToEth(pool, amount(winningBalance)) > 0n
			})
			return eligible(possible ? undefined : 'No redeemable wallet shares')
		},
		id,
		label: kind,
		method,
		risk: kind === 'create' ? 'medium' : 'low',
	}
}

const escalationDeposit: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(
			operationalPools(snapshot).flatMap(pool => {
				if (amount(pool.totalCapacityOwnershipAttoRep) > 0n && safeOraclePriceDeadline(snapshot, pool, options) === undefined) return []
				const configuredMaximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
				const outcomes = [0, 1, 2].filter(outcome => amount(pool.safeEscalationDepositMaximumsAttoRep[outcome] ?? '0') > 0n && amount(pool.safeEscalationDepositMaximumsAttoRep[outcome] ?? '0') <= configuredMaximum)
				return outcomes.length > 0 ? [{ outcomes, pool }] : []
			}),
			mixSeed(options.seed, escalationDeposit.id),
		)
		if (candidate === undefined) return undefined
		const outcome = choose(candidate.outcomes, mixSeed(options.seed, 'escalation-outcome'))
		if (outcome === undefined) return undefined
		const maximum = amount(candidate.pool.safeEscalationDepositMaximumsAttoRep[outcome] ?? '0')
		if (maximum === 0n) return undefined
		const oracleDeadline = amount(candidate.pool.totalCapacityOwnershipAttoRep) > 0n ? safeOraclePriceDeadline(snapshot, candidate.pool, options) : undefined
		if (amount(candidate.pool.totalCapacityOwnershipAttoRep) > 0n && oracleDeadline === undefined) return undefined
		return planBase({
			...(oracleDeadline === undefined ? {} : { deadlineTimestamp: oracleDeadline.toString() }),
			definitionId: escalationDeposit.id,
			ecosystem: 'statoblast',
			label: escalationDeposit.label,
			metadata: { maximumDepositAttoRep: maximum.toString(), outcome, pool: candidate.pool.address },
			postconditions: ['Accepted REP moves from vault backing into the escalation game'],
			risk: 'high',
			snapshot,
			steps: [
				encodeStep({
					abi: securityPoolAbi,
					args: [outcome, maximum],
					evidence: [eventEvidence(candidate.pool.address, 'DepositToEscalationGame(address,uint8,uint256,uint256,uint256,uint256,address)')],
					functionName: 'depositToEscalationGame',
					id: 'escalation-deposit',
					label: 'Deposit into escalation game',
					to: candidate.pool.address,
					walletAssetDebits: [securityPoolVaultRepDebit(candidate.pool.address, snapshot.wallet.address, maximum)],
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'SecurityPool',
	description: 'Deposits bounded wallet-vault REP on a random directional outcome.',
	discoveryInputs: ['escalation game', 'wallet vault backing', 'pool lifecycle'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const found = operationalPools(snapshot).some(pool => {
			if (amount(pool.totalCapacityOwnershipAttoRep) > 0n && safeOraclePriceDeadline(snapshot, pool, options) === undefined) return false
			const configuredMaximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
			return [0, 1, 2].some(outcome => {
				const maximum = amount(pool.safeEscalationDepositMaximumsAttoRep[outcome] ?? '0')
				return maximum > 0n && maximum <= configuredMaximum
			})
		})
		return eligible(options.allowHighRisk === true ? undefined : 'High-risk operations are disabled', found ? undefined : 'No active escalation game has an affordable protocol-valid deposit preview with a safely fresh price when capacity is nonzero')
	},
	id: 'statoblast.escalation.deposit',
	label: 'Deposit to escalation game',
	method: 'depositToEscalationGame',
	risk: 'high',
}

function previewWithdrawalAmount(pool: PoolSnapshot, vault: PoolSnapshot['vaults'][number], requestedAttoRep: bigint) {
	const totalBackingUnits = amount(pool.totalRepBackingUnits)
	const totalPoolHeldAttoRep = amount(pool.poolRepBalanceAttoRep)
	if (requestedAttoRep === 0n || totalBackingUnits === 0n || totalPoolHeldAttoRep === 0n) return 0n
	const requestedUnits = (requestedAttoRep * totalBackingUnits) / totalPoolHeldAttoRep
	const minimumRemainingUnits = (amount(pool.minimumVaultRepDepositAttoRep) * totalBackingUnits) / totalPoolHeldAttoRep
	const vaultUnits = amount(vault.repBackingUnits)
	const withdrawalUnits = requestedUnits + minimumRemainingUnits > vaultUnits ? vaultUnits : requestedUnits
	return (withdrawalUnits * totalPoolHeldAttoRep) / totalBackingUnits
}

const queueWithdrawal: OperationDefinition = {
	buildPlan(snapshot, options) {
		const configuredMaximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const pool = choose(
			operationalPools(snapshot).filter(candidate => {
				const vault = walletVault(snapshot, candidate)
				if (vault === undefined || amount(vault.repBackingAttoRep) === 0n || amount(vault.disputeStakedAttoRep) !== 0n) return false
				const requested = amount(vault.repBackingAttoRep) < configuredMaximum ? amount(vault.repBackingAttoRep) : configuredMaximum
				return safeOraclePriceDeadline(snapshot, candidate, options) !== undefined && amount(candidate.settlementCollateralAttoEth) <= amount(candidate.totalBadDebtAttoEth) && previewWithdrawalAmount(candidate, vault, requested) > 0n
			}),
			mixSeed(options.seed, queueWithdrawal.id),
		)
		if (pool === undefined) return undefined
		const vault = walletVault(snapshot, pool)
		if (vault === undefined) return undefined
		const requested = amount(vault.repBackingAttoRep) < configuredMaximum ? amount(vault.repBackingAttoRep) : configuredMaximum
		if (requested === 0n || previewWithdrawalAmount(pool, vault, requested) === 0n) return undefined
		const oracleDeadline = safeOraclePriceDeadline(snapshot, pool, options)
		if (oracleDeadline === undefined) return undefined
		const funding = oracleRequestStagingParameters(pool)
		const steps = []
		const evidence = [eventEvidence(pool.coordinator, 'StagedOperationQueued(uint256,uint8,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)'), decodedStagedSuccess(pool.coordinator)]
		steps.push(
			encodeStep({
				abi: coordinatorAbi,
				args: [1, snapshot.wallet.address, requested, STAGED_WITHDRAWAL_VALIDITY_SECONDS, funding.price, funding.initialWethAttoEth],
				evidence,
				functionName: 'requestPriceIfNeededAndStageOperation',
				id: 'queue-withdrawal',
				label: 'Queue REP withdrawal',
				preflightCalls: [
					encodePreflightCall({
						abi: securityPoolAbi,
						args: [snapshot.wallet.address, requested],
						caller: pool.coordinator,
						expectedResult: '0x',
						functionName: 'withdrawRepFromVault',
						label: 'withdraw queued REP directly',
						to: pool.address,
					}),
				],
				to: pool.coordinator,
			}),
		)
		return planBase({
			deadlineTimestamp: oracleDeadline.toString(),
			definitionId: queueWithdrawal.id,
			ecosystem: 'statoblast',
			label: queueWithdrawal.label,
			metadata: { amountAttoRep: requested.toString(), pool: pool.address },
			postconditions: ['The staged operation either succeeds immediately or remains durably discoverable as a lifecycle obligation'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'OpenOraclePriceCoordinator',
	description: 'Queues an oracle-gated REP withdrawal and records any resulting settlement obligation.',
	discoveryInputs: ['wallet vault backing', 'oracle freshness and request cost', 'wallet ETH'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const configuredMaximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const pools = operationalPools(snapshot).filter(candidate => {
			const vault = walletVault(snapshot, candidate)
			return vault !== undefined && amount(vault.repBackingAttoRep) > 0n && amount(vault.disputeStakedAttoRep) === 0n
		})
		const ready = pools.some(pool => {
			const vault = walletVault(snapshot, pool)
			if (vault === undefined) return false
			const requested = amount(vault.repBackingAttoRep) < configuredMaximum ? amount(vault.repBackingAttoRep) : configuredMaximum
			return safeOraclePriceDeadline(snapshot, pool, options) !== undefined && amount(pool.settlementCollateralAttoEth) <= amount(pool.totalBadDebtAttoEth) && previewWithdrawalAmount(pool, vault, requested) > 0n
		})
		return eligible(
			pools.length === 0 ? 'No unescrowed wallet vault has withdrawable REP' : undefined,
			configuredMaximum === 0n ? 'Configured REP operation cap is zero' : undefined,
			pools.length > 0 && !ready ? 'No eligible pool has a safely fresh price, zero open interest, and a nonzero rounded withdrawal' : undefined,
		)
	},
	id: 'statoblast.staged.queue',
	label: 'Queue REP withdrawal',
	method: 'requestPriceIfNeededAndStageOperation',
	risk: 'medium',
}

const ORACLE_REQUEST_DEFINITION_ID = 'statoblast.oracle.request-price'
const ORACLE_REQUEST_ENVELOPE_VERSION = 1

function oracleRequestMetadata(snapshot: EcosystemSnapshot, pool: PoolSnapshot, prepared: PreparedOracleRequest): OperationPlan['metadata'] {
	return {
		coordinator: pool.coordinator,
		maximumBaseFeePerGas: prepared.envelope.maximumBaseFeePerGas,
		maximumEscalationHaltAttoEth: prepared.envelope.maximumEscalationHaltAttoEth,
		maximumInitialAttoRep: prepared.envelope.maximumInitialAttoRep,
		maximumInitialAttoWeth: prepared.envelope.maximumInitialAttoWeth,
		maximumRequestPriceCostAttoEth: prepared.envelope.maximumRequestPriceCostAttoEth,
		oracleRequestEnvelopeVersion: ORACLE_REQUEST_ENVELOPE_VERSION,
		pool: pool.address,
		preparedAtBlock: snapshot.anchor.blockNumber,
		proposedRepPerEthPrice: prepared.price.toString(),
		repToken: pool.repToken,
		settlementCollateralCeilingAttoEth: prepared.settlementCollateralCeilingAttoEth.toString(),
		weth: snapshot.deployments.weth,
	}
}

function oracleRequestSteps(snapshot: EcosystemSnapshot, coordinator: `0x${string}`, weth: `0x${string}`, repToken: `0x${string}`, prepared: PreparedOracleRequest, forceExactApprovals: boolean) {
	const initialWethAttoEth = amount(prepared.envelope.maximumInitialAttoWeth)
	const initialRepAttoRep = amount(prepared.envelope.maximumInitialAttoRep)
	const requestCostAttoEth = amount(prepared.envelope.maximumRequestPriceCostAttoEth)
	const steps = []
	if (forceExactApprovals || allowance(tokenInventory(snapshot, weth), coordinator) !== initialWethAttoEth) {
		steps.push(approveCoordinatorToken(snapshot, coordinator, weth, initialWethAttoEth, 'approve-oracle-weth', 'Approve exact WETH oracle funding'))
	}
	if (forceExactApprovals || allowance(tokenInventory(snapshot, repToken), coordinator) !== initialRepAttoRep) {
		steps.push(approveCoordinatorToken(snapshot, coordinator, repToken, initialRepAttoRep, 'approve-oracle-rep', 'Approve exact REP oracle funding'))
	}
	steps.push(
		encodeStep({
			abi: coordinatorAbi,
			args: [prepared.price, initialWethAttoEth],
			evidence: [
				eventEvidence(coordinator, 'PriceRequested(uint256,uint256)'),
				exactTokenTransferToCoordinatorEvidence(snapshot, weth, coordinator, initialWethAttoEth),
				exactTokenTransferToCoordinatorEvidence(snapshot, repToken, coordinator, initialRepAttoRep),
				erc20AllowanceEvidence(weth, snapshot.wallet.address, coordinator, 0n),
				erc20AllowanceEvidence(repToken, snapshot.wallet.address, coordinator, 0n),
			],
			functionName: 'requestPrice',
			id: 'request-price',
			label: 'Request REP/ETH price',
			to: coordinator,
			value: requestCostAttoEth,
			walletAssetDebits: [erc20WalletDebit(weth, initialWethAttoEth, 'weth'), erc20WalletDebit(repToken, initialRepAttoRep, 'rep')],
		}),
	)
	return steps
}

function buildPreparedOracleRequestPlan(snapshot: EcosystemSnapshot, pool: PoolSnapshot, prepared: PreparedOracleRequest, metadata: OperationPlan['metadata'], forceExactApprovals: boolean, confirmedCleanupCount = 0) {
	const steps = oracleRequestSteps(snapshot, pool.coordinator, snapshot.deployments.weth, pool.repToken, prepared, forceExactApprovals)
	const plannedApprovalCount = steps.filter(step => step.id === 'approve-oracle-weth' || step.id === 'approve-oracle-rep').length
	const maximumCleanupTransactionCount = confirmedCleanupCount + plannedApprovalCount
	return planBase({
		definitionId: ORACLE_REQUEST_DEFINITION_ID,
		ecosystem: 'statoblast',
		label: 'Request oracle price',
		maximumCleanupTransactionCount: maximumCleanupTransactionCount === 0 ? undefined : maximumCleanupTransactionCount,
		metadata,
		postconditions: ['Coordinator pendingReportId becomes nonzero, both exact token allowances are consumed, and the report becomes a settlement obligation'],
		risk: 'medium',
		snapshot,
		steps,
		terminalSubmission: { kind: 'private-next-block', maximumFeePerGas: prepared.envelope.maximumBaseFeePerGas },
	})
}

function requiredOracleMetadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || value.length === 0) throw new Error(`Oracle request metadata ${key} is missing`)
	return value
}

function requiredOracleMetadataUint(metadata: OperationPlan['metadata'], key: string) {
	const value = requiredOracleMetadataString(metadata, key)
	if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`Oracle request metadata ${key} is not canonical`)
	return value
}

function persistedOracleRequest(plan: OperationPlan) {
	if (plan.metadata['oracleRequestEnvelopeVersion'] !== ORACLE_REQUEST_ENVELOPE_VERSION) {
		throw new Error('Oracle request workflow has an unsupported funding envelope version')
	}
	const envelope: OracleRequestFundingBounds = {
		maximumBaseFeePerGas: requiredOracleMetadataUint(plan.metadata, 'maximumBaseFeePerGas'),
		maximumEscalationHaltAttoEth: requiredOracleMetadataUint(plan.metadata, 'maximumEscalationHaltAttoEth'),
		maximumInitialAttoRep: requiredOracleMetadataUint(plan.metadata, 'maximumInitialAttoRep'),
		maximumInitialAttoWeth: requiredOracleMetadataUint(plan.metadata, 'maximumInitialAttoWeth'),
		maximumRequestPriceCostAttoEth: requiredOracleMetadataUint(plan.metadata, 'maximumRequestPriceCostAttoEth'),
	}
	return {
		coordinator: getAddress(requiredOracleMetadataString(plan.metadata, 'coordinator')),
		envelope,
		pool: getAddress(requiredOracleMetadataString(plan.metadata, 'pool')),
		preparedAtBlock: amount(requiredOracleMetadataUint(plan.metadata, 'preparedAtBlock')),
		prepared: {
			envelope,
			price: amount(requiredOracleMetadataUint(plan.metadata, 'proposedRepPerEthPrice')),
			settlementCollateralCeilingAttoEth: amount(requiredOracleMetadataUint(plan.metadata, 'settlementCollateralCeilingAttoEth')),
		},
		repToken: getAddress(requiredOracleMetadataString(plan.metadata, 'repToken')),
		settlementCollateralCeilingAttoEth: amount(requiredOracleMetadataUint(plan.metadata, 'settlementCollateralCeilingAttoEth')),
		weth: getAddress(requiredOracleMetadataString(plan.metadata, 'weth')),
	}
}

function exactPreviousOracleApproval(snapshot: EcosystemSnapshot, previousPlan: OperationPlan, id: string, coordinator: `0x${string}`, token: `0x${string}`, required: bigint) {
	const previous = previousPlan.steps.find(step => step.id === id)
	if (previous === undefined) return undefined
	const expected = approveCoordinatorToken(snapshot, coordinator, token, required, id, previous.label)
	return previous.to.toLowerCase() === expected.to.toLowerCase() && previous.data === expected.data ? previous : undefined
}

function oracleApprovalRequirements(persisted: ReturnType<typeof persistedOracleRequest>) {
	return [
		{ id: 'approve-oracle-weth', required: amount(persisted.envelope.maximumInitialAttoWeth), token: persisted.weth },
		{ id: 'approve-oracle-rep', required: amount(persisted.envelope.maximumInitialAttoRep), token: persisted.repToken },
	]
}

function confirmedOracleApprovalRequirements(snapshot: EcosystemSnapshot, context: OperationContinuationContext, persisted: ReturnType<typeof persistedOracleRequest>) {
	return oracleApprovalRequirements(persisted).filter(requirement => context.confirmedStepIds.includes(requirement.id) && exactPreviousOracleApproval(snapshot, context.previousPlan, requirement.id, persisted.coordinator, requirement.token, requirement.required) !== undefined)
}

function oracleRequestContinuationIsSafe(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, context: OperationContinuationContext, persisted: ReturnType<typeof persistedOracleRequest>) {
	try {
		const workflowValidForBlocks = options.workflowValidForBlocks ?? 288
		if (!Number.isSafeInteger(workflowValidForBlocks) || workflowValidForBlocks <= 0) return false
		if (options.submissionMode === 'public') return false
		const currentBlock = amount(snapshot.anchor.blockNumber)
		if (currentBlock < persisted.preparedAtBlock || currentBlock - persisted.preparedAtBlock > BigInt(workflowValidForBlocks)) return false
		if (!operationalPools(snapshot).some(candidate => candidate.address.toLowerCase() === pool.address.toLowerCase())) return false
		if (pool.oraclePriceValid || pool.pendingReportId !== '0') return false
		if (pool.coordinator.toLowerCase() !== persisted.coordinator.toLowerCase() || pool.repToken.toLowerCase() !== persisted.repToken.toLowerCase()) return false
		if (snapshot.deployments.weth.toLowerCase() !== persisted.weth.toLowerCase()) return false
		const currentPrice = amount(pool.lastRepPerEthPrice) > 0n ? amount(pool.lastRepPerEthPrice) : ONE_TOKEN
		if (currentPrice !== persisted.prepared.price) return false
		const currentCollateral = amount(pool.settlementCollateralAttoEth)
		if (currentCollateral > persisted.settlementCollateralCeilingAttoEth) return false
		const persistedWeth = amount(persisted.envelope.maximumInitialAttoWeth)
		const persistedRep = amount(persisted.envelope.maximumInitialAttoRep)
		const persistedBounty = amount(persisted.envelope.maximumRequestPriceCostAttoEth)
		if (persistedWeth + persistedBounty > optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)) return false
		if (persistedRep > optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)) return false
		assertOracleRequestFundingEnvelope({
			coordinator: pool.oracleRequestFunding,
			envelope: persisted.envelope,
			proposedRepPerEthPrice: persisted.prepared.price.toString(),
			settlementCollateralAttoEth: currentCollateral.toString(),
			subject: `Coordinator ${pool.coordinator}`,
		})
		if (maximumFeePerGas(amount(snapshot.anchor.baseFeePerGas)) > amount(persisted.envelope.maximumBaseFeePerGas)) return false
		if (context.previousPlan.terminalSubmission?.kind !== 'private-next-block' || context.previousPlan.terminalSubmission.maximumFeePerGas !== persisted.envelope.maximumBaseFeePerGas) return false
		for (const requirement of oracleApprovalRequirements(persisted)) {
			const previous = exactPreviousOracleApproval(snapshot, context.previousPlan, requirement.id, persisted.coordinator, requirement.token, requirement.required)
			if (context.previousPlan.steps.some(step => step.id === requirement.id) && previous === undefined) return false
			if (context.confirmedStepIds.includes(requirement.id)) {
				if (previous === undefined || allowance(tokenInventory(snapshot, requirement.token), persisted.coordinator) !== requirement.required) return false
			}
		}
		const wethAllowancePrepared = allowance(tokenInventory(snapshot, persisted.weth), persisted.coordinator) === amount(persisted.envelope.maximumInitialAttoWeth)
		const repAllowancePrepared = allowance(tokenInventory(snapshot, persisted.repToken), persisted.coordinator) === amount(persisted.envelope.maximumInitialAttoRep)
		const remainingApprovalCount = Number(!wethAllowancePrepared) + Number(!repAllowancePrepared)
		return oracleRequestInventoryIsFunded(snapshot, pool, options, persisted.prepared, remainingApprovalCount + 3)
	} catch (error) {
		if (!isOracleRequestFundingError(error)) throw error
		return false
	}
}

function buildOracleRequestCleanupPlan(snapshot: EcosystemSnapshot, context: OperationContinuationContext, persisted: ReturnType<typeof persistedOracleRequest>) {
	const confirmed = confirmedOracleApprovalRequirements(snapshot, context, persisted)
	if (confirmed.length === 0) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: ORACLE_REQUEST_DEFINITION_ID,
		ecosystem: 'statoblast',
		label: 'Clean up prepared oracle request',
		metadata: context.previousPlan.metadata,
		postconditions: ['Every confirmed workflow-created oracle funding allowance is zero'],
		risk: 'medium',
		snapshot,
		steps: confirmed.map(requirement => approveCoordinatorToken(snapshot, persisted.coordinator, requirement.token, 0n, `revoke-${requirement.id.slice('approve-'.length)}`, `Revoke ${requirement.id === 'approve-oracle-weth' ? 'WETH' : 'REP'} oracle funding`)),
	})
}

const requestOraclePrice: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(
			operationalPools(snapshot).flatMap(pool => {
				if (pool.oraclePriceValid || pool.pendingReportId !== '0') return []
				const prepared = oracleRequestPreparation(snapshot, pool, options)
				return prepared === undefined ? [] : [{ pool, prepared }]
			}),
			mixSeed(options.seed, requestOraclePrice.id),
		)
		if (candidate === undefined) return undefined
		return buildPreparedOracleRequestPlan(snapshot, candidate.pool, candidate.prepared, oracleRequestMetadata(snapshot, candidate.pool, candidate.prepared), true)
	},
	buildContinuationPlan(snapshot, options, context) {
		const persisted = persistedOracleRequest(context.previousPlan)
		if (context.continuationDisposition === 'cleanup-only') {
			return buildOracleRequestCleanupPlan(snapshot, context, persisted)
		}
		const pool = snapshot.pools.find(candidate => candidate.address.toLowerCase() === persisted.pool.toLowerCase() && candidate.coordinator.toLowerCase() === persisted.coordinator.toLowerCase())
		if (pool === undefined || !oracleRequestContinuationIsSafe(snapshot, pool, options, context, persisted)) {
			return buildOracleRequestCleanupPlan(snapshot, context, persisted)
		}
		return buildPreparedOracleRequestPlan(snapshot, pool, persisted.prepared, context.previousPlan.metadata, false, confirmedOracleApprovalRequirements(snapshot, context, persisted).length)
	},
	classification: 'selectable',
	contract: 'OpenOraclePriceCoordinator',
	description: 'Sponsors a bounded fresh REP/ETH report when the pool oracle is stale and no report is pending.',
	discoveryInputs: ['oracle freshness/pending report', 'request cost', 'WETH and REP balances/allowances'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const candidates = operationalPools(snapshot).filter(candidate => !candidate.oraclePriceValid && candidate.pendingReportId === '0')
		const prepared = candidates.some(pool => oracleRequestPreparation(snapshot, pool, options) !== undefined)
		return eligible(candidates.length === 0 ? 'No operational pool needs a new oracle price' : undefined, candidates.length > 0 && !prepared ? 'No stale pool has a durable policy-bounded funding envelope, token inventory, ETH gas reserve, and safe private inclusion fee ceiling' : undefined)
	},
	id: ORACLE_REQUEST_DEFINITION_ID,
	label: 'Request oracle price',
	method: 'requestPrice',
	risk: 'medium',
}

const recoverSettledReport: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(
			snapshot.pools.filter(candidate => candidate.pendingReportId !== '0' && candidate.pendingReportSettled),
			mixSeed(options.seed, recoverSettledReport.id),
		)
		if (pool === undefined) return undefined
		return planBase({
			definitionId: recoverSettledReport.id,
			ecosystem: 'statoblast',
			label: recoverSettledReport.label,
			metadata: { coordinator: pool.coordinator, reportId: pool.pendingReportId },
			postconditions: ['Coordinator consumes the settled pending report and advances any pending settlement operations'],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: coordinatorAbi, evidence: [eventEvidence(pool.coordinator, 'PendingReportRecovered(uint256,uint256,uint256,uint256,uint256,uint256)')], functionName: 'recoverSettledPendingReport', id: 'recover-report', label: 'Recover settled pending report', to: pool.coordinator })],
		})
	},
	buildLifecyclePlans(snapshot) {
		return snapshot.pools
			.filter(pool => pool.pendingReportId !== '0' && pool.pendingReportSettled)
			.map(pool =>
				planBase({
					definitionId: recoverSettledReport.id,
					ecosystem: 'statoblast',
					label: recoverSettledReport.label,
					metadata: { coordinator: pool.coordinator, reportId: pool.pendingReportId },
					postconditions: ['Coordinator consumes the settled pending report and advances any pending settlement operations'],
					priority: 'urgent',
					risk: 'low',
					snapshot,
					steps: [encodeStep({ abi: coordinatorAbi, evidence: [eventEvidence(pool.coordinator, 'PendingReportRecovered(uint256,uint256,uint256,uint256,uint256,uint256)')], functionName: 'recoverSettledPendingReport', id: 'recover-report', label: 'Recover settled pending report', to: pool.coordinator })],
				}),
			)
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return snapshot.pools.filter(pool => pool.pendingReportId !== '0' && pool.pendingReportSettled).map(pool => ({ coordinator: pool.coordinator, reportId: pool.pendingReportId }))
	},
	enumerateLifecyclePresence(snapshot) {
		return snapshot.pools.filter(pool => pool.pendingReportId !== '0' && pool.pendingReportSettled).map(pool => ({ coordinator: pool.coordinator, reportId: pool.pendingReportId }))
	},
	classification: 'lifecycle-obligation',
	contract: 'OpenOraclePriceCoordinator',
	description: 'Recovers a settled stored OpenOracle report whose callback did not clear the coordinator slot.',
	discoveryInputs: ['coordinator pending report', 'OpenOracle storedGame settlement timestamp'],
	ecosystem: 'statoblast',
	evaluate: snapshot => eligible(snapshot.pools.some(pool => pool.pendingReportId !== '0' && pool.pendingReportSettled) ? undefined : 'No settled pending coordinator report requires recovery'),
	id: 'statoblast.oracle.recover-report',
	label: 'Recover settled oracle report',
	method: 'recoverSettledPendingReport',
	risk: 'low',
}

const queueLiquidation: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'excluded-dangerous',
	contract: 'OpenOraclePriceCoordinator',
	description: 'The coordinator snapshots mutable target and pool state only at inclusion, so calldata cannot bind the simulated result or require zero bad debt.',
	discoveryInputs: ['liquidation calldata guards', 'atomic state binding'],
	ecosystem: 'statoblast',
	evaluate: () => disabled('Unguarded liquidation queueing can execute a different inclusion-time result, including nonzero bad debt'),
	id: 'statoblast.liquidation.queue',
	label: 'Queue liquidation (excluded)',
	method: 'requestPriceIfNeededAndStageLiquidation',
	risk: 'high',
}

const resumeEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(
			snapshot.pools.filter(candidate => candidate.awaitingForkContinuation && candidate.systemState === 0 && candidate.escalationGame !== zeroAddress && candidate.escalationForkCarryFundingComplete && candidate.escalationForkResumedAt === '0'),
			mixSeed(options.seed, resumeEscalation.id),
		)
		if (pool === undefined) return undefined
		return planBase({
			definitionId: resumeEscalation.id,
			ecosystem: 'statoblast',
			label: resumeEscalation.label,
			metadata: { pool: pool.address },
			postconditions: ['Forked escalation game records its resumption time'],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: securityPoolAbi, evidence: [eventEvidence(pool.escalationGame, 'ForkContinuationResumed(uint256)')], functionName: 'resumeForkedEscalationGame', id: 'resume-escalation', label: 'Resume forked escalation game', to: pool.address })],
		})
	},
	buildLifecyclePlans(snapshot) {
		return snapshot.pools
			.filter(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkCarryFundingComplete && pool.escalationForkResumedAt === '0')
			.map(pool =>
				planBase({
					definitionId: resumeEscalation.id,
					ecosystem: 'statoblast',
					label: resumeEscalation.label,
					metadata: { pool: pool.address },
					postconditions: ['Forked escalation game records its resumption time'],
					priority: 'urgent',
					risk: 'low',
					snapshot,
					steps: [encodeStep({ abi: securityPoolAbi, evidence: [eventEvidence(pool.escalationGame, 'ForkContinuationResumed(uint256)')], functionName: 'resumeForkedEscalationGame', id: 'resume-escalation', label: 'Resume forked escalation game', to: pool.address })],
				}),
			)
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return snapshot.pools.filter(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkCarryFundingComplete && pool.escalationForkResumedAt === '0').map(pool => ({ pool: pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return snapshot.pools.filter(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkResumedAt === '0').map(pool => ({ pool: pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPool',
	description: 'Permissionlessly resumes a child escalation game after its fork continuation is initialized.',
	discoveryInputs: ['pool fork continuation flag/state', 'child escalation game'],
	ecosystem: 'statoblast',
	evaluate: snapshot => eligible(snapshot.pools.some(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkCarryFundingComplete && pool.escalationForkResumedAt === '0') ? undefined : 'No fully funded child escalation game is waiting to resume'),
	id: 'statoblast.escalation.resume',
	label: 'Resume forked escalation game',
	method: 'resumeForkedEscalationGame',
	risk: 'low',
}

function claimForkedEscalationCandidates(snapshot: EcosystemSnapshot, options?: PlanningOptions, enforceTopologyCapacity = options !== undefined) {
	const now = amount(snapshot.anchor.timestamp)
	const candidates = snapshot.pools.flatMap(pool => {
		const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		const deadlineAvailable = options === undefined ? now <= deadline : timestampDeadlineHasRequiredSafety(now, deadline, options)
		if (pool.systemState !== 1 || !pool.forkOwnQuestion || !pool.forkUnresolvedEscalation || !pool.escalationCanTriggerOwnFork || amount(pool.forkActivationTime) === 0n || !deadlineAvailable) return []
		const deposits = snapshot.escalationDeposits.filter(deposit => !deposit.claimed && deposit.pool.toLowerCase() === pool.address.toLowerCase() && deposit.vault.toLowerCase() === snapshot.wallet.address.toLowerCase()).sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex))
		return [...new Set(deposits.map(deposit => deposit.outcome))].flatMap(outcome => lifecycleBatches(deposits.filter(deposit => deposit.outcome === outcome)).map(batch => ({ deadline, deposits: batch, outcome, pool })))
	})
	return enforceTopologyCapacity && options !== undefined ? candidates.filter(candidate => childRouteTopologyCapacityBlocker(snapshot, candidate.pool, candidate.outcome.toString(), options, 'Forked escalation claim child route') === undefined) : candidates
}

function claimForkedDepositIndexes(candidate: ReturnType<typeof claimForkedEscalationCandidates>[number]) {
	return [...candidate.deposits].sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex)).map(deposit => BigInt(deposit.depositIndex))
}

function claimForkedMetadata(candidate: ReturnType<typeof claimForkedEscalationCandidates>[number]) {
	const depositIndexes = claimForkedDepositIndexes(candidate)
	return { depositCount: depositIndexes.length, depositIndexes: depositIndexes.map(index => index.toString()).join(','), outcome: candidate.outcome, pool: candidate.pool.address }
}

function buildClaimForkedEscalationPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof claimForkedEscalationCandidates>[number]) {
	const depositIndexes = claimForkedDepositIndexes(candidate)
	return planBase({
		deadlineTimestamp: candidate.deadline.toString(),
		definitionId: claimForkedEscalation.id,
		ecosystem: 'statoblast',
		label: claimForkedEscalation.label,
		metadata: claimForkedMetadata(candidate),
		postconditions: ['Selected fork-time deposits are claimed into the wallet and marked terminal by the canonical index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address, snapshot.wallet.address, candidate.outcome, depositIndexes],
				evidence: [eventEvidence(snapshot.deployments.securityPoolForker, 'ClaimForkedEscalationDepositsToWallet(address,address,uint8,uint256[],uint256,uint256,bool)')],
				functionName: 'claimForkedEscalationDeposits',
				id: 'claim-forked-escalation',
				label: 'Claim forked escalation deposits',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

const claimForkedEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(claimForkedEscalationCandidates(snapshot, options), mixSeed(options.seed, claimForkedEscalation.id))
		return candidate === undefined ? undefined : buildClaimForkedEscalationPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return claimForkedEscalationCandidates(snapshot, options).map(candidate => buildClaimForkedEscalationPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot, options) {
		return claimForkedEscalationCandidates(snapshot, options, false).map(claimForkedMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return claimForkedEscalationCandidates(snapshot).map(claimForkedMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Claims canonically indexed wallet deposits during an own-question fork migration window.',
	discoveryInputs: ['canonical escalation deposit index', 'fork ownership/unresolved state', 'fork activation deadline'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const obstructing = claimForkedEscalationCandidates(snapshot, options, false)
		const actionable = claimForkedEscalationCandidates(snapshot, options)
		const first = obstructing[0]
		const capacityBlocker = first === undefined || actionable.length > 0 ? undefined : childRouteTopologyCapacityBlocker(snapshot, first.pool, first.outcome.toString(), options, 'Forked escalation claim child route')
		return eligible(capacityBlocker, obstructing.length > 0 ? undefined : 'No indexed own-fork escalation deposit is claimable before its migration deadline')
	},
	id: 'statoblast.escalation.claim-forked',
	label: 'Claim forked escalation deposits',
	method: 'claimForkedEscalationDeposits',
	risk: 'low',
}

function unresolvedMigrationCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.pools.flatMap(pool => {
		const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		const validOutcomes = new Set(forkOutcomesForPool(snapshot, pool))
		if (pool.systemState !== 1 || !pool.forkUnresolvedEscalation || validOutcomes.size === 0 || amount(pool.forkActivationTime) === 0n || !timestampDeadlineHasRequiredSafety(now, deadline, options)) return []
		return pool.unresolvedEscalationMigrationReadyOutcomes.flatMap(outcome => {
			const outcomeIndex = BigInt(outcome)
			const notMaterialized = outcomeIndex > 2n || pool.walletEscalationMaterializedOutcomes[Number(outcomeIndex)] === false
			return validOutcomes.has(outcome) && notMaterialized ? [{ deadline, outcome, pool }] : []
		})
	})
}

function actionableUnresolvedMigrationCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return unresolvedMigrationCandidates(snapshot, options).filter(candidate => walletVaultMigrationRouteCapacityBlocker(snapshot, candidate.pool, candidate.outcome, options, 'Unresolved vault migration child route') === undefined)
}

function unresolvedMigrationPresenceCandidates(snapshot: EcosystemSnapshot) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.pools.flatMap(pool => {
		const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		if (pool.systemState !== 1 || !pool.forkUnresolvedEscalation || amount(pool.forkActivationTime) === 0n || now > deadline) return []
		return forkOutcomesForPool(snapshot, pool).flatMap(outcome => {
			const outcomeIndex = BigInt(outcome)
			const notMaterialized = outcomeIndex <= 2n ? pool.walletEscalationMaterializedOutcomes[Number(outcomeIndex)] === false : pool.unresolvedEscalationMigrationReadyOutcomes.includes(outcome)
			return notMaterialized ? [{ deadline, outcome, pool }] : []
		})
	})
}

function buildUnresolvedMigrationPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof unresolvedMigrationCandidates>[number]) {
	return planBase({
		deadlineTimestamp: candidate.deadline.toString(),
		definitionId: migrateVaultWithUnresolvedEscalation.id,
		ecosystem: 'statoblast',
		label: migrateVaultWithUnresolvedEscalation.label,
		metadata: { childOutcomeIndex: candidate.outcome, pool: candidate.pool.address },
		postconditions: ['The wallet escalation entitlement is initialized and materialized exactly once for the child outcome'],
		priority: 'urgent',
		risk: 'irreversible',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address, snapshot.wallet.address, BigInt(candidate.outcome)],
				evidence: [eventEvidence(snapshot.deployments.securityPoolForker, 'EscalationMigrationEntitlementMaterialized(address,address,uint256,address,uint256)')],
				functionName: 'migrateVaultWithUnresolvedEscalation',
				id: 'migrate-unresolved-escalation',
				label: 'Materialize unresolved escalation entitlement',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

const migrateVaultWithUnresolvedEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(actionableUnresolvedMigrationCandidates(snapshot, options), mixSeed(options.seed, migrateVaultWithUnresolvedEscalation.id))
		return candidate === undefined ? undefined : buildUnresolvedMigrationPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return actionableUnresolvedMigrationCandidates(snapshot, options).map(candidate => buildUnresolvedMigrationPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot, options) {
		return unresolvedMigrationCandidates(snapshot, options).map(candidate => ({ childOutcomeIndex: candidate.outcome, pool: candidate.pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return unresolvedMigrationPresenceCandidates(snapshot).map(candidate => ({ childOutcomeIndex: candidate.outcome, pool: candidate.pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Materializes the wallet vault and unresolved escalation entitlement into an unmaterialized child outcome.',
	discoveryInputs: ['fork activation deadline', 'unresolved fork state', 'wallet entitlement materialization bitmap'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const obstructing = unresolvedMigrationCandidates(snapshot, options)
		const actionable = actionableUnresolvedMigrationCandidates(snapshot, options)
		const first = obstructing[0]
		const capacityBlocker = first === undefined || actionable.length > 0 ? undefined : walletVaultMigrationRouteCapacityBlocker(snapshot, first.pool, first.outcome, options, 'Unresolved vault migration child route')
		return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', capacityBlocker, obstructing.length > 0 ? undefined : 'No unresolved wallet escalation entitlement remains inside its migration window')
	},
	id: 'statoblast.fork.migrate-vault-unresolved',
	label: 'Migrate vault with unresolved escalation',
	method: 'migrateVaultWithUnresolvedEscalation',
	risk: 'irreversible',
}

function stagedObligation(mode: 'execute' | 'expire'): OperationDefinition {
	const id = `statoblast.staged.${mode}`
	const metadata = (staged: EcosystemSnapshot['stagedOperations'][number]) => ({ coordinator: staged.coordinator, operationId: staged.id, operationType: staged.operation })
	const stagedDeadline = (pool: PoolSnapshot, operation: EcosystemSnapshot['stagedOperations'][number]) => amount(operation.queuedAt) + amount(pool.oracleSettlementTime) + amount(operation.validForSeconds)
	const executionDeadline = (pool: PoolSnapshot, operation: EcosystemSnapshot['stagedOperations'][number]) => {
		const operationDeadline = stagedDeadline(pool, operation)
		const oracleDeadline = amount(pool.lastOracleSettlementTimestamp) + ORACLE_PRICE_VALIDITY_SECONDS
		return operationDeadline < oracleDeadline ? operationDeadline : oracleDeadline
	}
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.stagedOperations.filter(operation => {
			const pool = snapshot.pools.find(candidate => candidate.coordinator.toLowerCase() === operation.coordinator.toLowerCase())
			if (pool === undefined) return false
			return mode === 'execute' ? operation.operation === 1 && operation.executionExpectedSuccess && pool.oraclePriceValid && timestampDeadlineHasRequiredSafety(now, executionDeadline(pool, operation), options) : now > stagedDeadline(pool, operation)
		})
	}
	const build = (snapshot: EcosystemSnapshot, staged: EcosystemSnapshot['stagedOperations'][number]) => {
		const pool = snapshot.pools.find(candidate => candidate.coordinator.toLowerCase() === staged.coordinator.toLowerCase())
		if (pool === undefined) return undefined
		const deadline = (mode === 'execute' ? executionDeadline(pool, staged) : stagedDeadline(pool, staged)).toString()
		const signature = 'ExecutedStagedOperation(uint256,uint8,bool,string)'
		const successEvidence: OperationEvidence = {
			abi: 'event ExecutedStagedOperation(uint256 indexed operationId, uint8 operation, bool success, string errorMessage)',
			emitter: staged.coordinator,
			equals: mode === 'execute',
			field: 'success',
			indexed: { operationId: staged.id },
			kind: 'decoded-event-field',
			signature,
			topic0: eventTopic(signature),
		}
		const evidence: OperationEvidence[] = [successEvidence]
		evidence.push({ ...successEvidence, equals: staged.operation, field: 'operation' })
		if (mode === 'expire') {
			evidence.push({
				abi: successEvidence.abi,
				emitter: staged.coordinator,
				equals: 'staged operation expired',
				field: 'errorMessage',
				indexed: { operationId: staged.id },
				kind: 'decoded-event-field',
				signature,
				topic0: successEvidence.topic0,
			})
		}
		const preflight = mode === 'execute' ? stagedDownstreamPreflight(pool, staged) : undefined
		if (mode === 'execute' && preflight === undefined) return undefined
		return planBase({
			deadlineTimestamp: mode === 'execute' ? deadline : undefined,
			definitionId: id,
			ecosystem: 'statoblast',
			label: mode === 'execute' ? 'Execute staged operation' : 'Expire staged operation',
			metadata: metadata(staged),
			postconditions: [mode === 'execute' ? 'Decoded ExecutedStagedOperation.success is true; success=false is a failed workflow' : 'The expired operation is consumed and no longer active'],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: coordinatorAbi,
					args: [BigInt(staged.id)],
					evidence,
					functionName: mode === 'execute' ? 'executeStagedOperation' : 'expireStagedOperation',
					id: `${mode}-staged-${staged.id}`,
					label: `${mode} staged operation ${staged.id}`,
					preflightCalls: preflight === undefined ? [] : [preflight],
					to: staged.coordinator,
				}),
			],
		})
	}
	return {
		buildPlan(snapshot, options) {
			const staged = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return staged === undefined ? undefined : build(snapshot, staged)
		},
		buildLifecyclePlans(snapshot, options) {
			return candidates(snapshot, options).flatMap(staged => {
				const plan = build(snapshot, staged)
				return plan === undefined ? [] : [plan]
			})
		},
		enumerateLifecycleObstructingPresence(snapshot, options) {
			return candidates(snapshot, options).map(metadata)
		},
		enumerateLifecyclePresence(snapshot) {
			return snapshot.stagedOperations.filter(operation => mode === 'expire' || operation.operation === 1).map(metadata)
		},
		classification: 'lifecycle-obligation',
		contract: 'OpenOraclePriceCoordinator',
		description: `${mode === 'execute' ? 'Executes a fresh oracle-gated workflow and requires semantic success' : 'Consumes an expired workflow so it cannot block recovery'}.`,
		discoveryInputs: ['active staged operations', 'oracle validity', 'settlement time', 'anchor timestamp', 'anchored direct mutation simulation'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			const now = amount(snapshot.anchor.timestamp)
			const found = snapshot.stagedOperations.some(operation => {
				const pool = snapshot.pools.find(candidate => candidate.coordinator.toLowerCase() === operation.coordinator.toLowerCase())
				if (pool === undefined) return false
				return mode === 'execute' ? operation.operation === 1 && operation.executionExpectedSuccess && pool.oraclePriceValid && timestampDeadlineHasRequiredSafety(now, executionDeadline(pool, operation), options) : now > stagedDeadline(pool, operation)
			})
			return eligible(found ? undefined : `No staged operation is ready to ${mode}`)
		},
		id,
		label: `${mode} staged operation`,
		method: mode === 'execute' ? 'executeStagedOperation' : 'expireStagedOperation',
		risk: 'low',
	}
}

const executeStagedLiquidation: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'excluded-dangerous',
	contract: 'OpenOraclePriceCoordinator',
	description: 'Executing a staged liquidation is delegated to a policy-aware liquidator because live price, open interest, and pool accounting can change the irreversible bad-debt result after preflight.',
	discoveryInputs: ['active staged liquidation operation', 'mutable liquidation accounting and ordering risk'],
	ecosystem: 'statoblast',
	evaluate: () => disabled('Staged liquidation execution cannot bind its irreversible live-state result at inclusion'),
	id: 'statoblast.staged.execute-liquidation-excluded',
	label: 'Execute staged liquidation (excluded)',
	method: 'executeStagedOperation',
	risk: 'high',
}

function forkDefinition(kind: 'initiate' | 'migrate-rep' | 'create-child' | 'migrate-vault' | 'own-question'): OperationDefinition {
	const details = {
		'create-child': ['createChildUniverse', 'statoblast.fork.create-child'],
		initiate: ['initiateSecurityPoolFork', 'statoblast.fork.initiate'],
		'migrate-rep': ['migrateRepToZoltar', 'statoblast.fork.migrate-rep'],
		'migrate-vault': ['migrateVault', 'statoblast.fork.migrate-vault'],
		'own-question': ['forkZoltarWithOwnEscalationGame', 'statoblast.fork.own-question'],
	} as const
	const [method, id] = details[kind]
	type ForkCandidate = { deadline: bigint | undefined; outcome: string; pool: PoolSnapshot }
	type VaultMigrationCandidate = { deadline: bigint; pool: PoolSnapshot; routes: string[] }
	const isOpenChildRoute = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string) => {
		const child = childPoolForOutcome(snapshot, pool, outcome)
		return child === undefined || child.systemState === 2
	}
	const migrateRepPresenceCandidates = (snapshot: EcosystemSnapshot): ForkCandidate[] =>
		snapshot.pools.flatMap(pool => {
			if (amount(pool.forkActivationTime) === 0n) return []
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			const target = amount(pool.forkRepMigrationTargetAttoRep)
			if (target === 0n) return []
			return forkOutcomesForPool(snapshot, pool).flatMap(outcome => {
				const progress = amount(pool.forkRepMigrationProgressByOutcome[outcome] ?? '0')
				return progress < target ? [{ deadline, outcome, pool }] : []
			})
		})
	const createChildPresenceCandidates = (snapshot: EcosystemSnapshot): ForkCandidate[] => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.pools.flatMap(pool => {
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			if (pool.systemState !== 1 || amount(pool.forkActivationTime) === 0n || now > deadline) return []
			const children = snapshot.pools.filter(child => child.parent.toLowerCase() === pool.address.toLowerCase())
			return forkOutcomesForPool(snapshot, pool)
				.filter(outcome => !children.some(child => child.forkOutcomeIndex === outcome))
				.map(outcome => ({ deadline, outcome, pool }))
		})
	}
	const vaultMigrationPresenceCandidates = (snapshot: EcosystemSnapshot) => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.pools.flatMap(pool => {
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			const vault = walletVault(snapshot, pool)
			if (pool.systemState !== 1 || amount(pool.forkActivationTime) === 0n || now > deadline || forkOutcomesForPool(snapshot, pool).length === 0 || vault === undefined || amount(vault.repBackingUnits) === 0n) return []
			return [{ deadline, pool }]
		})
	}
	const vaultMigrationCandidates = (snapshot: EcosystemSnapshot, options: PlanningOptions, enforceCapacity = true): VaultMigrationCandidate[] => {
		const now = amount(snapshot.anchor.timestamp)
		return vaultMigrationPresenceCandidates(snapshot).flatMap(candidate => {
			if (!timestampDeadlineHasRequiredSafety(now, candidate.deadline, options)) return []
			const routes = forkOutcomesForPool(snapshot, candidate.pool).filter(outcome => isOpenChildRoute(snapshot, candidate.pool, outcome) && (!enforceCapacity || walletVaultMigrationRouteCapacityBlocker(snapshot, candidate.pool, outcome, options, 'Vault migration child route') === undefined))
			return routes.length === 0 ? [] : [{ ...candidate, routes }]
		})
	}
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions, enforceCapacity = true): ForkCandidate[] => {
		const now = amount(snapshot.anchor.timestamp)
		if (kind === 'migrate-rep') {
			return migrateRepPresenceCandidates(snapshot).filter(
				candidate =>
					candidate.pool.systemState === 1 &&
					candidate.deadline !== undefined &&
					timestampDeadlineHasRequiredSafety(now, candidate.deadline, options) &&
					isOpenChildRoute(snapshot, candidate.pool, candidate.outcome) &&
					(!enforceCapacity || childUniverseTopologyCapacityBlocker(snapshot, candidate.pool, candidate.outcome, options, 'Pool-held REP migration child universe') === undefined),
			)
		}
		if (kind === 'migrate-vault') return []
		return snapshot.pools.flatMap<ForkCandidate>(pool => {
			const universe = snapshot.universes.find(value => value.id === pool.universeId)
			const children = snapshot.pools.filter(child => child.parent.toLowerCase() === pool.address.toLowerCase())
			const forkOutcomes = forkOutcomesForPool(snapshot, pool)
			const missingChildOutcomes = forkOutcomes.filter(outcome => !children.some(candidate => candidate.forkOutcomeIndex === outcome))
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			if (kind === 'initiate') return universe !== undefined && universe.forkTime !== '0' && pool.systemState === 0 && pool.forkActivationTime === '0' && pool.questionOutcome === BINARY_OUTCOME_NONE ? [{ deadline: undefined, outcome: '0', pool }] : []
			if (kind === 'own-question') {
				const forkThreshold = universe === undefined ? 0n : amount(universe.forkThresholdAttoRep)
				const forkBurnDivisor = universe?.forkBurnDivisor === undefined ? 0n : amount(universe.forkBurnDivisor)
				const gameRep = amount(pool.escalationRepBalanceAttoRep)
				return universe !== undefined &&
					forkBurnDivisor > 0n &&
					universe.forkTime === '0' &&
					pool.systemState === 0 &&
					pool.forkActivationTime === '0' &&
					pool.escalationGame !== zeroAddress &&
					pool.escalationCanTriggerOwnFork &&
					amount(pool.poolRepBalanceAttoRep) + gameRep >= forkThreshold &&
					gameRep >= forkThreshold / forkBurnDivisor
					? [{ deadline: undefined, outcome: '0', pool }]
					: []
			}
			if (kind === 'create-child' && forkOutcomes.length === 0) return []
			if (pool.systemState !== 1 || amount(pool.forkActivationTime) === 0n || !timestampDeadlineHasRequiredSafety(now, deadline, options)) return []
			return missingChildOutcomes.flatMap(outcome => (!enforceCapacity || childRouteTopologyCapacityBlocker(snapshot, pool, outcome, options, 'Child pool creation route') === undefined ? [{ deadline, outcome, pool }] : []))
		})
	}
	const candidateMetadata = (candidate: ForkCandidate): Record<string, string | number | boolean> => {
		const metadata: Record<string, string | number | boolean> = kind === 'migrate-vault' ? { pool: candidate.pool.address } : { outcome: candidate.outcome, pool: candidate.pool.address }
		if (kind === 'migrate-rep') metadata['targetAttoRep'] = candidate.pool.forkRepMigrationTargetAttoRep
		return metadata
	}
	const build = (snapshot: EcosystemSnapshot, candidate: ForkCandidate) => {
		const outcome = candidate.outcome
		let args: readonly unknown[] = [candidate.pool.address]
		if (kind === 'migrate-rep') args = [candidate.pool.address, [BigInt(outcome)]]
		else if (kind === 'create-child' || kind === 'migrate-vault') args = [candidate.pool.address, BigInt(outcome)]
		let evidence: OperationEvidence[]
		if (kind === 'initiate') evidence = [eventEvidence(candidate.pool.address, 'PoolForkModeActivated(uint256,uint256,uint8)')]
		else if (kind === 'create-child') evidence = [eventEvidence(snapshot.deployments.securityPoolForker, 'ChildPoolLinked(address,uint256,address,address)')]
		else if (kind === 'migrate-vault') {
			const child = childPoolForOutcome(snapshot, candidate.pool, outcome)
			evidence = [decodedVaultMigrationEvidence(snapshot, candidate.pool, 'outcomeIndex', outcome, child), decodedVaultMigrationEvidence(snapshot, candidate.pool, 'resultingParentRepBackingUnits', '0', child)]
		} else if (kind === 'own-question') evidence = [eventEvidence(snapshot.deployments.zoltar, 'UniverseForked(address,uint248,uint256,uint256,uint256,uint256,uint256)')]
		else evidence = [decodedChildRepSplitEvidence(snapshot, candidate.pool, outcome)]
		let postconditions = ['Fork workflow advances without violating canonical parent/child accounting']
		if (kind === 'migrate-vault') postconditions = [`The wallet source vault reaches zero backing on the canonical outcome ${outcome} child route`]
		if (kind === 'migrate-rep') postconditions = ['The next canonical scan confirms the indexed child REP split reached its immutable fork target, including when another keeper won the race']
		const plan = planBase({
			definitionId: id,
			ecosystem: 'statoblast',
			label: kind === 'migrate-vault' ? `Fork workflow: migrate-vault through outcome ${outcome}` : `Fork workflow: ${kind}`,
			metadata: candidateMetadata(candidate),
			postconditions,
			priority: candidate.deadline === undefined ? 'random' : 'urgent',
			risk: 'irreversible',
			snapshot,
			steps: [
				encodeStep({
					abi: securityPoolForkerAbi,
					args,
					evidence,
					functionName: method,
					id: kind === 'migrate-rep' || kind === 'migrate-vault' ? `${method}-${candidate.pool.address.toLowerCase()}-${outcome}` : method,
					label: kind === 'migrate-vault' ? `migrate-vault through outcome ${outcome}` : kind,
					to: snapshot.deployments.securityPoolForker,
				}),
			],
		})
		if (candidate.deadline !== undefined) plan.deadlineTimestamp = candidate.deadline.toString()
		return plan
	}
	let discoveryInputs = ['pool fork state', 'universe tree', 'wallet vault state']
	if (kind === 'migrate-vault') discoveryInputs = ['pool fork state', 'universe tree', 'wallet source-vault backing', 'existing canonical child route state']
	if (kind === 'migrate-rep') discoveryInputs = ['pool fork state', 'universe tree', 'canonical indexed child REP split progress']
	return {
		buildPlan(snapshot, options) {
			if (kind === 'migrate-vault') {
				const candidate = choose(vaultMigrationCandidates(snapshot, options), mixSeed(options.seed, id))
				if (candidate === undefined) return undefined
				const route = choose(candidate.routes, mixSeed(options.seed, `${id}:${candidate.pool.address.toLowerCase()}`))
				return route === undefined ? undefined : build(snapshot, { deadline: candidate.deadline, outcome: route, pool: candidate.pool })
			}
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return candidate === undefined ? undefined : build(snapshot, candidate)
		},
		buildLifecyclePlans(snapshot, options) {
			if (kind === 'migrate-vault') {
				return vaultMigrationCandidates(snapshot, options).flatMap(candidate => {
					const route = choose(candidate.routes, mixSeed(options.seed, `${id}:${candidate.pool.address.toLowerCase()}`))
					if (route === undefined) return []
					const plan = build(snapshot, { deadline: candidate.deadline, outcome: route, pool: candidate.pool })
					return plan === undefined ? [] : [plan]
				})
			}
			return candidates(snapshot, options).flatMap(candidate => {
				const plan = build(snapshot, candidate)
				return plan === undefined ? [] : [plan]
			})
		},
		enumerateLifecycleObstructingPresence(snapshot, options) {
			if (kind === 'migrate-vault') {
				return vaultMigrationCandidates(snapshot, options, false).flatMap(candidate => {
					const route = choose(candidate.routes, mixSeed(options.seed, `${id}:${candidate.pool.address.toLowerCase()}`))
					if (route === undefined) return []
					return [candidateMetadata({ deadline: candidate.deadline, outcome: route, pool: candidate.pool })]
				})
			}
			return candidates(snapshot, options, false).map(candidateMetadata)
		},
		enumerateLifecyclePresence(snapshot, options) {
			if (kind === 'migrate-rep') {
				return migrateRepPresenceCandidates(snapshot).map(candidate => ({ outcome: candidate.outcome, pool: candidate.pool.address, targetAttoRep: candidate.pool.forkRepMigrationTargetAttoRep }))
			}
			if (kind === 'migrate-vault') return vaultMigrationPresenceCandidates(snapshot).map(candidate => ({ pool: candidate.pool.address }))
			if (kind === 'create-child') return createChildPresenceCandidates(snapshot).map(candidate => ({ outcome: candidate.outcome, pool: candidate.pool.address }))
			return candidates(snapshot, options).flatMap(candidate => {
				const plan = build(snapshot, candidate)
				return plan === undefined ? [] : [plan.metadata]
			})
		},
		classification: kind === 'create-child' || kind === 'migrate-rep' || kind === 'migrate-vault' ? 'lifecycle-obligation' : 'selectable',
		contract: 'SecurityPoolForker',
		description: kind === 'migrate-vault' ? 'Migrates the wallet vault through one canonical child route and requires terminal zero source backing in the receipt.' : `Advances the permissionless ${kind} phase of pool fork migration.`,
		discoveryInputs,
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			if (kind === 'migrate-vault') {
				const obstructing = vaultMigrationCandidates(snapshot, options, false)
				const actionable = vaultMigrationCandidates(snapshot, options)
				const first = obstructing[0]
				const route = first?.routes[0]
				const capacityBlocker = first === undefined || route === undefined || actionable.length > 0 ? undefined : walletVaultMigrationRouteCapacityBlocker(snapshot, first.pool, route, options, 'Vault migration child route')
				return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', capacityBlocker, obstructing.length > 0 ? undefined : 'No pool is in the exact required fork phase')
			}
			const obstructing = candidates(snapshot, options, false)
			const actionable = candidates(snapshot, options)
			const first = obstructing[0]
			let capacityBlocker: string | undefined
			if (first !== undefined && actionable.length === 0) {
				if (kind === 'create-child') capacityBlocker = childRouteTopologyCapacityBlocker(snapshot, first.pool, first.outcome, options, 'Child pool creation route')
				if (kind === 'migrate-rep') capacityBlocker = childUniverseTopologyCapacityBlocker(snapshot, first.pool, first.outcome, options, 'Pool-held REP migration child universe')
			}
			return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', capacityBlocker, obstructing.length > 0 ? undefined : 'No pool is in the exact required fork phase')
		},
		id,
		label: `Fork ${kind}`,
		method,
		risk: 'irreversible',
	}
}

function auctionDefinition(kind: 'bid' | 'withdraw-refund'): OperationDefinition {
	const id = `statoblast.auction.${kind}`
	const method = kind === 'bid' ? 'submitBid' : 'withdrawPendingEthRefund'
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.auctions.filter(candidate =>
			kind === 'bid'
				? !candidate.finalized && amount(candidate.startTime) > 0n && timestampDeadlineHasRequiredSafety(now, amount(candidate.endTime), options) && ethSpend(snapshot, options, id, amount(candidate.minimumBidAttoEth)) >= amount(candidate.minimumBidAttoEth)
				: amount(candidate.pendingEthRefund) > 0n && candidate.pendingEthRefundGeneration !== undefined,
		)
	}
	const build = (snapshot: EcosystemSnapshot, options: PlanningOptions, auction: EcosystemSnapshot['auctions'][number]) => {
		const bid = kind === 'bid' ? ethSpend(snapshot, options, id, amount(auction.minimumBidAttoEth)) : 0n
		const tick = (mixSeed(options.seed, 'auction-tick') % 20_001) - 10_000
		const signature = kind === 'bid' ? 'BidSubmitted(address,int256,uint256,uint256,uint256)' : 'PendingEthRefundWithdrawn(address,uint256)'
		let metadata: Record<string, string | number | boolean>
		if (kind === 'bid') {
			metadata = { auction: auction.address, bidAttoEth: bid.toString(), pendingRefundBefore: auction.pendingEthRefund, tick }
		} else {
			const refundGeneration = auction.pendingEthRefundGeneration
			if (refundGeneration === undefined) throw new Error(`Auction ${auction.address} pending refund has no authenticated generation`)
			metadata = { auction: auction.address, refundGeneration }
		}
		return planBase({
			deadlineTimestamp: kind === 'bid' ? auction.endTime : undefined,
			definitionId: id,
			ecosystem: 'statoblast',
			label: `Auction ${kind}`,
			metadata,
			postconditions: [kind === 'bid' ? 'Bid is indexed for the wallet at the selected tick' : 'Pending ETH refund becomes zero'],
			priority: kind === 'bid' ? 'random' : 'urgent',
			risk: kind === 'bid' ? 'high' : 'low',
			snapshot,
			steps: [encodeStep({ abi: auctionAbi, args: kind === 'bid' ? [tick] : undefined, evidence: [eventEvidence(auction.address, signature)], functionName: method, id: method, label: kind, to: auction.address, value: kind === 'bid' ? bid : undefined })],
		})
	}
	return {
		buildPlan(snapshot, options) {
			const auction = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return auction === undefined ? undefined : build(snapshot, options, auction)
		},
		buildLifecyclePlans(snapshot, options) {
			return kind === 'withdraw-refund' ? candidates(snapshot, options).map(auction => build(snapshot, options, auction)) : []
		},
		enumerateLifecycleObstructingPresence(snapshot, options) {
			return kind === 'withdraw-refund'
				? candidates(snapshot, options).map(auction => {
						const refundGeneration = auction.pendingEthRefundGeneration
						if (refundGeneration === undefined) throw new Error(`Auction ${auction.address} pending refund has no authenticated generation`)
						return { auction: auction.address, refundGeneration }
					})
				: []
		},
		enumerateLifecyclePresence(snapshot) {
			return kind === 'withdraw-refund'
				? snapshot.auctions.flatMap(auction => {
						const refundGeneration = auction.pendingEthRefundGeneration
						return amount(auction.pendingEthRefund) > 0n && refundGeneration !== undefined ? [{ auction: auction.address, refundGeneration }] : []
					})
				: []
		},
		classification: kind === 'bid' ? 'selectable' : 'lifecycle-obligation',
		contract: 'UniformPriceDualCapBatchAuction',
		description: `${kind} for a discovered truth auction.`,
		discoveryInputs: ['truth auction lifecycle', 'wallet bids/refunds', 'wallet ETH'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			const now = amount(snapshot.anchor.timestamp)
			const found = snapshot.auctions.some(auction =>
				kind === 'bid'
					? !auction.finalized && amount(auction.startTime) > 0n && timestampDeadlineHasRequiredSafety(now, amount(auction.endTime), options) && ethSpend(snapshot, options, id, amount(auction.minimumBidAttoEth)) >= amount(auction.minimumBidAttoEth)
					: amount(auction.pendingEthRefund) > 0n && auction.pendingEthRefundGeneration !== undefined,
			)
			return eligible(kind === 'bid' && options.allowHighRisk !== true ? 'High-risk operations are disabled' : undefined, found ? undefined : `No auction is eligible to ${kind}`)
		},
		id,
		label: `Auction ${kind}`,
		method,
		risk: kind === 'bid' ? 'high' : 'low',
	}
}

function truthAuctionStartCandidates(snapshot: EcosystemSnapshot) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.pools.filter(pool => {
		const auction = snapshot.auctions.find(value => value.pool.toLowerCase() === pool.address.toLowerCase())
		return pool.systemState === 2 && pool.parent !== zeroAddress && auction?.startTime === '0' && amount(pool.parentForkActivationTime) > 0n && now > amount(pool.parentForkActivationTime) + MIGRATION_TIME_SECONDS
	})
}

function buildTruthAuctionStartPlan(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	return planBase({
		definitionId: startTruthAuction.id,
		ecosystem: 'statoblast',
		label: startTruthAuction.label,
		metadata: { pool: pool.address },
		postconditions: ['The child leaves migration state and either starts or atomically finalizes its truth auction'],
		priority: 'urgent',
		risk: 'irreversible',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [pool.address],
				evidence: [{ abi: 'function systemState() view returns (uint8)', args: [], contract: pool.address, functionName: 'systemState', kind: 'storage-postcondition', relation: 'changed' }],
				functionName: 'startTruthAuction',
				id: 'start-truth-auction',
				label: 'Start truth auction',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

const startTruthAuction: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(truthAuctionStartCandidates(snapshot), mixSeed(options.seed, startTruthAuction.id))
		return pool === undefined ? undefined : buildTruthAuctionStartPlan(snapshot, pool)
	},
	buildLifecyclePlans(snapshot) {
		return truthAuctionStartCandidates(snapshot).map(pool => buildTruthAuctionStartPlan(snapshot, pool))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return truthAuctionStartCandidates(snapshot).map(pool => ({ pool: pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return truthAuctionStartCandidates(snapshot).map(pool => ({ pool: pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Advances a child pool out of its completed migration window by starting its truth auction route.',
	discoveryInputs: ['child and parent pool relation', 'parent fork activation deadline', 'child system state', 'auction start time'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const now = amount(snapshot.anchor.timestamp)
		const found = snapshot.pools.some(pool => {
			const auction = snapshot.auctions.find(value => value.pool.toLowerCase() === pool.address.toLowerCase())
			return pool.systemState === 2 && pool.parent !== zeroAddress && auction?.startTime === '0' && amount(pool.parentForkActivationTime) > 0n && now > amount(pool.parentForkActivationTime) + MIGRATION_TIME_SECONDS
		})
		return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', found ? undefined : 'No child pool has completed migration and awaits auction start')
	},
	id: 'statoblast.auction.start',
	label: 'Start truth auction route',
	method: 'startTruthAuction',
	risk: 'irreversible',
}

function truthAuctionFinalizeCandidates(snapshot: EcosystemSnapshot) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.auctions.flatMap(auction => {
		const pool = snapshot.pools.find(value => value.address.toLowerCase() === auction.pool.toLowerCase())
		return pool !== undefined && pool.systemState === 3 && !auction.finalized && amount(auction.startTime) > 0n && now > amount(auction.endTime) ? [{ auction, pool }] : []
	})
}

function buildTruthAuctionFinalizePlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof truthAuctionFinalizeCandidates>[number]) {
	return planBase({
		definitionId: finalizeTruthAuctionRoute.id,
		ecosystem: 'statoblast',
		label: finalizeTruthAuctionRoute.label,
		metadata: { auction: candidate.auction.address, pool: candidate.pool.address },
		postconditions: ['The forker consumes the auction and restores the child pool to operational state'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address],
				evidence: [eventEvidence(snapshot.deployments.securityPoolForker, 'TruthAuctionFinalized(address)')],
				functionName: 'finalizeTruthAuction',
				id: 'finalize-truth-auction-route',
				label: 'Finalize truth auction route',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

const finalizeTruthAuctionRoute: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(truthAuctionFinalizeCandidates(snapshot), mixSeed(options.seed, finalizeTruthAuctionRoute.id))
		return candidate === undefined ? undefined : buildTruthAuctionFinalizePlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot) {
		return truthAuctionFinalizeCandidates(snapshot).map(candidate => buildTruthAuctionFinalizePlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return truthAuctionFinalizeCandidates(snapshot).map(candidate => ({ auction: candidate.auction.address, pool: candidate.pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return truthAuctionFinalizeCandidates(snapshot).map(candidate => ({ auction: candidate.auction.address, pool: candidate.pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Finalizes an elapsed forker-owned truth auction and reconciles the child pool accounting atomically.',
	discoveryInputs: ['child system state', 'auction start/end/finalization state', 'anchor timestamp'],
	ecosystem: 'statoblast',
	evaluate(snapshot) {
		const now = amount(snapshot.anchor.timestamp)
		const found = snapshot.auctions.some(auction => {
			const pool = snapshot.pools.find(value => value.address.toLowerCase() === auction.pool.toLowerCase())
			return pool !== undefined && pool.systemState === 3 && !auction.finalized && amount(auction.startTime) > 0n && now > amount(auction.endTime)
		})
		return eligible(found ? undefined : 'No elapsed truth auction route is ready to finalize')
	},
	id: 'statoblast.auction.finalize-route',
	label: 'Finalize truth auction route',
	method: 'finalizeTruthAuction',
	risk: 'low',
}

function finalizedAuctionBidCanCreditVault(auction: EcosystemSnapshot['auctions'][number], bid: EcosystemSnapshot['auctions'][number]['bids'][number]) {
	if (BigInt(bid.tick) < BigInt(auction.clearingTick)) return false
	return !auction.underfunded || amount(auction.underfundedWinningAttoEth) > 0n
}

function finalizedAuctionBidCandidates(snapshot: EcosystemSnapshot, options?: PlanningOptions) {
	return snapshot.auctions.flatMap(auction => {
		const pool = snapshot.pools.find(value => value.address.toLowerCase() === auction.pool.toLowerCase())
		if (!auction.finalized || pool === undefined) return []
		const bids = auction.bids.filter(bid => !bid.refunded).sort(compareAuctionBids)
		const batches = [...lifecycleBatches(bids.filter(bid => !finalizedAuctionBidCanCreditVault(auction, bid))), ...lifecycleBatches(bids.filter(bid => finalizedAuctionBidCanCreditVault(auction, bid)))]
		return batches.flatMap(batch => {
			const canCreditVault = batch.some(bid => finalizedAuctionBidCanCreditVault(auction, bid))
			if (options !== undefined && canCreditVault && walletVaultRegistrationCapacityBlocker(pool, options, 'Winning auction settlement vault registration') !== undefined) return []
			return [{ auction, bids: batch, pool }]
		})
	})
}

function finalizedAuctionBidMetadata(candidate: ReturnType<typeof finalizedAuctionBidCandidates>[number]) {
	return {
		auction: candidate.auction.address,
		bidCount: candidate.bids.length,
		bidKeys: candidate.bids
			.map(bid => `${bid.tick}:${bid.index}`)
			.sort()
			.join(','),
		pool: candidate.pool.address,
	}
}

function buildSettleAuctionBidsPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof finalizedAuctionBidCandidates>[number]) {
	const tickIndices = candidate.bids.map(bid => ({ bidIndex: BigInt(bid.index), tick: BigInt(bid.tick) }))
	return planBase({
		definitionId: settleAuctionBids.id,
		ecosystem: 'statoblast',
		label: settleAuctionBids.label,
		metadata: finalizedAuctionBidMetadata(candidate),
		postconditions: ['Every selected wallet bid emits BidSettled and is pruned from the durable index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address, snapshot.wallet.address, tickIndices, []],
				evidence: [eventEvidence(candidate.auction.address, 'BidSettled(address,int256,uint256,uint256,uint256,uint256,uint256,uint8)')],
				functionName: 'settleAuctionBids',
				id: 'settle-auction-bids',
				label: 'Settle wallet auction bids',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

const settleAuctionBids: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(finalizedAuctionBidCandidates(snapshot, options), mixSeed(options.seed, settleAuctionBids.id))
		return candidate === undefined ? undefined : buildSettleAuctionBidsPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return finalizedAuctionBidCandidates(snapshot, options).map(candidate => buildSettleAuctionBidsPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return finalizedAuctionBidCandidates(snapshot).map(finalizedAuctionBidMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return finalizedAuctionBidCandidates(snapshot).map(finalizedAuctionBidMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Settles all canonically indexed wallet bids after the forker-owned auction finalizes.',
	discoveryInputs: ['canonical wallet bid index', 'auction finalization state', 'pool/auction route'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const obstructing = finalizedAuctionBidCandidates(snapshot)
		const actionable = finalizedAuctionBidCandidates(snapshot, options)
		const firstWinning = obstructing.find(candidate => candidate.bids.some(bid => finalizedAuctionBidCanCreditVault(candidate.auction, bid)))
		const capacityBlocker = firstWinning === undefined || actionable.length > 0 ? undefined : walletVaultRegistrationCapacityBlocker(firstWinning.pool, options, 'Winning auction settlement vault registration')
		return eligible(capacityBlocker, obstructing.length > 0 ? undefined : 'No finalized indexed wallet bid remains unsettled')
	},
	id: 'statoblast.auction.settle-bids',
	label: 'Settle auction bids',
	method: 'settleAuctionBids',
	risk: 'low',
}

function escalationWithdrawalCandidates(snapshot: EcosystemSnapshot) {
	return snapshot.pools.flatMap(pool => {
		if (pool.systemState !== 0 || pool.questionOutcome === BINARY_OUTCOME_NONE || !escalationWithdrawalSafe(snapshot, pool)) return []
		const deposits = snapshot.escalationDeposits.filter(deposit => !deposit.claimed && deposit.pool.toLowerCase() === pool.address.toLowerCase() && deposit.vault.toLowerCase() === snapshot.wallet.address.toLowerCase()).sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex))
		return [...new Set(deposits.map(deposit => deposit.outcome))].flatMap(outcome => lifecycleBatches(deposits.filter(deposit => deposit.outcome === outcome)).map(batch => ({ deposits: batch, outcome, pool })))
	})
}

function escalationWithdrawalIndexes(candidate: ReturnType<typeof escalationWithdrawalCandidates>[number]) {
	return [...candidate.deposits].sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex)).map(deposit => BigInt(deposit.depositIndex))
}

function escalationWithdrawalMetadata(candidate: ReturnType<typeof escalationWithdrawalCandidates>[number]) {
	const indexes = escalationWithdrawalIndexes(candidate)
	return { depositCount: indexes.length, depositIndexes: indexes.map(index => index.toString()).join(','), outcome: candidate.outcome, pool: candidate.pool.address }
}

function buildEscalationWithdrawalPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof escalationWithdrawalCandidates>[number]) {
	const indexes = escalationWithdrawalIndexes(candidate)
	const winning = candidate.outcome === candidate.pool.questionOutcome
	const signature = winning ? 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)' : 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'
	return planBase({
		definitionId: withdrawEscalation.id,
		ecosystem: 'statoblast',
		label: withdrawEscalation.label,
		metadata: escalationWithdrawalMetadata(candidate),
		postconditions: [winning ? 'Every selected winning deposit emits ClaimDeposit and is marked terminal by the canonical index' : 'Every selected losing deposit emits CarryDepositConsumed and is marked terminal by the canonical index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [encodeStep({ abi: securityPoolAbi, args: [candidate.outcome, indexes], evidence: [eventEvidence(candidate.pool.escalationGame, signature)], functionName: 'withdrawFromEscalationGame', id: 'withdraw-escalation', label: 'Withdraw resolved escalation deposits', to: candidate.pool.address })],
	})
}

const withdrawEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(escalationWithdrawalCandidates(snapshot), mixSeed(options.seed, withdrawEscalation.id))
		return candidate === undefined ? undefined : buildEscalationWithdrawalPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot) {
		return escalationWithdrawalCandidates(snapshot).map(candidate => buildEscalationWithdrawalPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return escalationWithdrawalCandidates(snapshot).map(escalationWithdrawalMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return escalationWithdrawalCandidates(snapshot).map(escalationWithdrawalMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPool',
	description: 'Withdraws indexed wallet escalation deposits after the pool question resolves.',
	discoveryInputs: ['canonical escalation deposit index', 'pool question outcome and lifecycle'],
	ecosystem: 'statoblast',
	evaluate(snapshot) {
		const found = snapshot.escalationDeposits.some(
			deposit => !deposit.claimed && deposit.vault.toLowerCase() === snapshot.wallet.address.toLowerCase() && snapshot.pools.some(pool => pool.address.toLowerCase() === deposit.pool.toLowerCase() && pool.systemState === 0 && pool.questionOutcome !== BINARY_OUTCOME_NONE && escalationWithdrawalSafe(snapshot, pool)),
		)
		return eligible(found ? undefined : 'No resolved wallet escalation deposit is withdrawable')
	},
	id: 'statoblast.escalation.withdraw',
	label: 'Withdraw escalation deposits',
	method: 'withdrawFromEscalationGame',
	risk: 'low',
}

function refundableAuctionCandidates(snapshot: EcosystemSnapshot) {
	return snapshot.auctions.flatMap(auction => {
		if (auction.finalized || !auction.hasClearingPrice) return []
		return auction.bids
			.filter(bid => !bid.refunded && BigInt(bid.tick) < BigInt(auction.clearingTick))
			.sort(compareAuctionBids)
			.map(bid => ({ auction, bid }))
	})
}

function buildAuctionRefundPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof refundableAuctionCandidates>[number]) {
	const refundable = [{ bidIndex: BigInt(candidate.bid.index), tick: BigInt(candidate.bid.tick) }]
	return planBase({
		definitionId: refundLosingAuctionBids.id,
		ecosystem: 'statoblast',
		label: refundLosingAuctionBids.label,
		metadata: { auction: candidate.auction.address, bidIndex: candidate.bid.index, tick: candidate.bid.tick },
		postconditions: ['The selected losing bid emits BidSettled and becomes unavailable in the canonical index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: auctionAbi,
				args: [refundable],
				evidence: [eventEvidence(candidate.auction.address, 'BidSettled(address,int256,uint256,uint256,uint256,uint256,uint256,uint8)')],
				functionName: 'refundLosingBids',
				id: `refund-losing-bid-${candidate.bid.tick}-${candidate.bid.index}`,
				label: 'Refund losing auction bid',
				to: candidate.auction.address,
			}),
		],
	})
}

const refundLosingAuctionBids: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(refundableAuctionCandidates(snapshot), mixSeed(options.seed, refundLosingAuctionBids.id))
		return candidate === undefined ? undefined : buildAuctionRefundPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot) {
		return refundableAuctionCandidates(snapshot).map(candidate => buildAuctionRefundPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return refundableAuctionCandidates(snapshot).map(candidate => ({ auction: candidate.auction.address, bidIndex: candidate.bid.index, tick: candidate.bid.tick }))
	},
	enumerateLifecyclePresence(snapshot) {
		return snapshot.auctions.flatMap(auction =>
			auction.finalized
				? []
				: auction.bids
						.filter(bid => !bid.refunded)
						.sort(compareAuctionBids)
						.map(bid => ({ auction: auction.address, bidIndex: bid.index, tick: bid.tick })),
		)
	},
	classification: 'lifecycle-obligation',
	contract: 'UniformPriceDualCapBatchAuction',
	description: 'Refunds indexed wallet bids strictly below a live clearing tick before finalization.',
	discoveryInputs: ['canonical auction bid index', 'computeClearing result', 'auction lifecycle'],
	ecosystem: 'statoblast',
	evaluate(snapshot) {
		const found = snapshot.auctions.some(auction => !auction.finalized && auction.hasClearingPrice && auction.bids.some(bid => !bid.refunded && BigInt(bid.tick) < BigInt(auction.clearingTick)))
		return eligible(found ? undefined : 'No indexed wallet bid is currently refundable')
	},
	id: 'statoblast.auction.refund',
	label: 'Refund losing auction bids',
	method: 'refundLosingBids',
	risk: 'low',
}

function buildResidualSweepPlan(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	const signature = pool.escalationForkContinuation ? 'ForkContinuationResidualRepBurned(uint256)' : 'ResidualRepSweptToSecurityPool(uint256)'
	return planBase({
		definitionId: sweepResidualEscalation.id,
		ecosystem: 'statoblast',
		label: sweepResidualEscalation.label,
		metadata: { balanceBefore: pool.escalationRepBalanceAttoRep, escalationGame: pool.escalationGame, pool: pool.address },
		postconditions: ['The terminal non-owner escalation REP residue is transferred to the pool and continuation residue is burned when required'],
		priority: 'random',
		risk: 'low',
		snapshot,
		steps: [encodeStep({ abi: escalationGameAbi, evidence: [eventEvidence(pool.escalationGame, signature)], functionName: 'sweepResidualRepToSecurityPool', id: 'sweep-residual', label: 'Sweep terminal escalation REP', to: pool.escalationGame })],
	})
}

const sweepResidualEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(
			snapshot.pools.filter(candidate => candidate.escalationResidualSweepExpectedSuccess),
			mixSeed(options.seed, sweepResidualEscalation.id),
		)
		return pool === undefined ? undefined : buildResidualSweepPlan(snapshot, pool)
	},
	classification: 'selectable',
	contract: 'EscalationGame',
	description: 'Selectably sweeps terminal ownerless escalation REP only after the exact mutation succeeds in an anchored simulation.',
	discoveryInputs: ['escalation finality', 'unresolved principal', 'escrow totals', 'REP balance', 'anchored mutation simulation'],
	ecosystem: 'statoblast',
	evaluate: snapshot => eligible(snapshot.pools.some(pool => pool.escalationResidualSweepExpectedSuccess) ? undefined : 'No escalation game has a simulated terminal residual sweep'),
	id: 'statoblast.escalation.sweep-residual',
	label: 'Sweep residual escalation REP',
	method: 'sweepResidualRepToSecurityPool',
	risk: 'low',
}

function carriedProofArgument(candidate: NonNullable<EcosystemSnapshot['forkedCarryWithdrawals']>[number]) {
	return {
		amountAttoRep: amount(candidate.proof.amountAttoRep),
		cumulativeAmountAttoRep: amount(candidate.proof.cumulativeAmountAttoRep),
		depositor: candidate.proof.depositor,
		leafIndex: amount(candidate.proof.leafIndex),
		merkleMountainRangePeakIndex: amount(candidate.proof.merkleMountainRangePeakIndex),
		merkleMountainRangeSiblings: candidate.proof.merkleMountainRangeSiblings,
		nullifierSiblings: candidate.proof.nullifierSiblings,
		parentDepositIndex: amount(candidate.proof.parentDepositIndex),
		sourceNodeId: amount(candidate.proof.sourceNodeId),
	}
}

function carriedDepositEvidence(candidate: NonNullable<EcosystemSnapshot['forkedCarryWithdrawals']>[number]): OperationEvidence[] {
	const carryIndexed = {
		depositor: candidate.depositor,
		parentDepositIndex: candidate.parentDepositIndex,
		sourceNodeId: candidate.sourceNodeId,
	}
	const claimIndexed = {
		depositor: candidate.depositor,
		outcome: candidate.outcome.toString(),
		parentDepositIndex: candidate.parentDepositIndex,
	}
	const carryField = (field: string, equals: string | number | boolean): OperationEvidence => ({
		abi: CARRY_DEPOSIT_CONSUMED_ABI,
		emitter: candidate.game,
		equals,
		field,
		indexed: carryIndexed,
		kind: 'decoded-event-field',
		signature: CARRY_DEPOSIT_CONSUMED_SIGNATURE,
		topic0: eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE),
	})
	const claimField = (field: string, equals: string | number | boolean): OperationEvidence => ({
		abi: CLAIM_DEPOSIT_ABI,
		emitter: candidate.game,
		equals,
		field,
		indexed: claimIndexed,
		kind: 'decoded-event-field',
		signature: CLAIM_DEPOSIT_SIGNATURE,
		topic0: eventTopic(CLAIM_DEPOSIT_SIGNATURE),
	})
	return [
		carryField('reason', 0),
		carryField('outcome', candidate.outcome),
		carryField('attoRepAmount', candidate.amountAttoRep),
		carryField('resultingUnresolvedTotalAttoRep', candidate.resultingUnresolvedTotalAttoRep),
		carryField('resultingNullifierRoot', candidate.resultingNullifierRoot),
		carryField('resultingCarryRoot', candidate.resultingCarryRoot),
		claimField('transferredRep', true),
		claimField('originalDepositAmountAttoRep', candidate.amountAttoRep),
		claimField('amountToWithdrawAttoRep', candidate.amountToWithdrawAttoRep),
		claimField('burnAmountAttoRep', candidate.burnAmountAttoRep),
	]
}

function forkedCarryMetadata(candidate: Pick<NonNullable<EcosystemSnapshot['forkedCarryWithdrawals']>[number], 'claimSourceGame' | 'game' | 'outcome' | 'parentDepositIndex' | 'pool' | 'sourceGame' | 'sourceNodeId'>) {
	return {
		claimSourceGame: candidate.claimSourceGame,
		game: candidate.game,
		outcome: candidate.outcome,
		parentDepositIndex: candidate.parentDepositIndex,
		pool: candidate.pool,
		sourceGame: candidate.sourceGame,
		sourceNodeId: candidate.sourceNodeId,
	}
}

function buildForkedCarryWithdrawalPlan(snapshot: EcosystemSnapshot, candidate: NonNullable<EcosystemSnapshot['forkedCarryWithdrawals']>[number]) {
	const proof = carriedProofArgument(candidate)
	return planBase({
		definitionId: withdrawForkedCarry.id,
		ecosystem: 'statoblast',
		label: withdrawForkedCarry.label,
		lastValidBlockNumber: (amount(snapshot.anchor.blockNumber) + 1n).toString(),
		metadata: forkedCarryMetadata(candidate),
		postconditions: ['The inherited deposit is nullified once and its retained winning REP is transferred to the committed depositor'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolAbi,
				args: [candidate.outcome, [proof]],
				evidence: carriedDepositEvidence(candidate),
				functionName: 'withdrawForkedEscalationDeposits',
				id: `withdraw-forked-${candidate.outcome.toString()}-${candidate.parentDepositIndex}-${candidate.sourceNodeId}`,
				label: 'Withdraw one inherited escalation deposit',
				preflightCalls: [
					encodePreflightCall({
						abi: securityPoolAbi,
						args: [candidate.outcome, [proof]],
						caller: snapshot.wallet.address,
						expectedResult: candidate.preflightExpectedResult,
						functionName: 'withdrawForkedEscalationDeposits',
						label: 'Revalidate inherited escalation proof',
						to: candidate.pool,
					}),
				],
				to: candidate.pool,
			}),
		],
	})
}

function actionableForkedCarryWithdrawals(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return (snapshot.forkedCarryWithdrawals ?? []).filter(candidate => {
		if (candidate.depositor.toLowerCase() !== snapshot.wallet.address.toLowerCase()) return false
		const pool = snapshot.pools.find(value => value.address.toLowerCase() === candidate.pool.toLowerCase())
		return pool !== undefined && walletVaultRegistrationCapacityBlocker(pool, options, 'Forked carry withdrawal vault registration') === undefined
	})
}

const withdrawForkedCarry: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(actionableForkedCarryWithdrawals(snapshot, options), mixSeed(options.seed, withdrawForkedCarry.id))
		return candidate === undefined ? undefined : buildForkedCarryWithdrawalPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return actionableForkedCarryWithdrawals(snapshot, options).map(candidate => buildForkedCarryWithdrawalPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		if (snapshot.forkedCarryWithdrawalPresence === undefined) {
			return (snapshot.forkedCarryWithdrawals ?? []).map(forkedCarryMetadata)
		}
		return snapshot.forkedCarryWithdrawalPresence
			.filter(candidate => {
				const pool = snapshot.pools.find(value => value.address.toLowerCase() === candidate.pool.toLowerCase())
				return pool !== undefined && pool.escalationGame.toLowerCase() === candidate.game.toLowerCase() && pool.systemState === 0 && pool.escalationResolved && pool.forkCarrySnapshotInitialized && pool.escalationFinalQuestionResolution === candidate.outcome && pool.questionOutcome === candidate.outcome
			})
			.map(forkedCarryMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return (snapshot.forkedCarryWithdrawalPresence ?? snapshot.forkedCarryWithdrawals ?? []).map(forkedCarryMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPool',
	description: 'Withdraws one canonically replayed, anchor-verified inherited escalation deposit per private next-block transaction.',
	discoveryInputs: ['durable carry journal', 'historical MMR proof', 'sparse nullifier proof', 'anchored source/child graph and direct-claim state'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const verified = snapshot.forkedCarryWithdrawals ?? []
		const actionable = actionableForkedCarryWithdrawals(snapshot, options)
		const first = verified.find(candidate => candidate.depositor.toLowerCase() === snapshot.wallet.address.toLowerCase())
		const pool = first === undefined ? undefined : snapshot.pools.find(value => value.address.toLowerCase() === first.pool.toLowerCase())
		const capacityBlocker = pool === undefined || actionable.length > 0 ? undefined : walletVaultRegistrationCapacityBlocker(pool, options, 'Forked carry withdrawal vault registration')
		return eligible(capacityBlocker, verified.length > 0 ? undefined : 'No verified wallet-owned inherited escalation deposit is withdrawable', first !== undefined ? undefined : 'Verified inherited escalation deposit is not owned by the configured wallet')
	},
	id: 'statoblast.escalation.withdraw-forked',
	label: 'Withdraw forked escalation deposits',
	method: 'withdrawForkedEscalationDeposits',
	risk: 'low',
}

export const STATOBLAST_OPERATIONS: readonly OperationDefinition[] = [
	deployPool,
	checkpointDefinition('collateral'),
	checkpointDefinition('retention'),
	depositVault,
	vaultActionDefinition('update-fees'),
	vaultActionDefinition('redeem-fees'),
	vaultActionDefinition('redeem-rep'),
	completeSetDefinition('create'),
	completeSetDefinition('redeem'),
	completeSetDefinition('winning'),
	escalationDeposit,
	queueWithdrawal,
	requestOraclePrice,
	recoverSettledReport,
	queueLiquidation,
	resumeEscalation,
	claimForkedEscalation,
	migrateVaultWithUnresolvedEscalation,
	stagedObligation('execute'),
	executeStagedLiquidation,
	stagedObligation('expire'),
	forkDefinition('initiate'),
	forkDefinition('migrate-rep'),
	forkDefinition('create-child'),
	forkDefinition('migrate-vault'),
	forkDefinition('own-question'),
	startTruthAuction,
	finalizeTruthAuctionRoute,
	settleAuctionBids,
	auctionDefinition('bid'),
	auctionDefinition('withdraw-refund'),
	withdrawEscalation,
	withdrawForkedCarry,
	sweepResidualEscalation,
	refundLosingAuctionBids,
]
