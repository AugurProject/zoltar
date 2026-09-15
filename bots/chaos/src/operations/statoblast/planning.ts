import { ONE_TOKEN, allowance, amount, encodePreflightCall, encodeStep, erc20AllowanceEvidence, eventTopic, optionAmount, planBase, tokenInventory } from '../planning.ts'

import { EcosystemSnapshot, OperationContinuationContext, OperationEvidence, OperationPlan, PlanningOptions, PoolSnapshot } from '../types.ts'

import { validForkOutcomeRoutes } from '../fork-outcomes.ts'

import { topologyMutationCapacityBlocker } from '../topology-capacity.ts'

import { timestampDeadlineHasRequiredSafety } from '../timing.ts'

import { sharesToProjectedEth } from '../pool-economics.ts'

import { erc20Abi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'

import { isOracleRequestFundingError, oracleRequestFundingEnvelope, oracleRequestSettlementCollateralCeiling, type OracleRequestFundingBounds } from '../oracle-request-funding.ts'

import { maximumFeePerGas } from '@zoltar/bot-shared/execution/transaction-submission'

export const BINARY_OUTCOME_NONE = 3

export const MIGRATION_TIME_SECONDS = 8n * 7n * 24n * 60n * 60n

const LIFECYCLE_BATCH_LIMIT = 16

export const ORACLE_PRICE_VALIDITY_SECONDS = 5n * 60n

export const STAGED_WITHDRAWAL_VALIDITY_SECONDS = 5n * 60n

export const CARRY_DEPOSIT_CONSUMED_SIGNATURE = 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'

export const CARRY_DEPOSIT_CONSUMED_ABI = 'event CarryDepositConsumed(uint256 indexed parentDepositIndex, uint256 indexed sourceNodeId, address indexed depositor, uint8 outcome, uint256 attoRepAmount, uint8 reason, uint256 resultingUnresolvedTotalAttoRep, bytes32 resultingNullifierRoot, bytes32 resultingCarryRoot)'

export const CLAIM_DEPOSIT_SIGNATURE = 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)'

export const CLAIM_DEPOSIT_ABI = 'event ClaimDeposit(address indexed depositor, uint8 indexed outcome, uint256 indexed parentDepositIndex, uint256 originalDepositAmountAttoRep, uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep, bool transferredRep)'

const CHILD_REP_SPLIT_SIGNATURE = 'ChildRepSplit(address,uint256,uint256,uint256)'

const CHILD_REP_SPLIT_ABI = 'event ChildRepSplit(address indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep)'

export const DEPOSIT_ON_OUTCOME_SIGNATURE = 'DepositOnOutcome(address,uint8,uint256,uint256,uint256,uint256,uint256)'

export const DEPOSIT_ON_OUTCOME_ABI = 'event DepositOnOutcome(address indexed depositor, uint8 indexed outcome, uint256 attoRepAmount, uint256 depositIndex, uint256 cumulativeRepAmountAttoRep, uint256 resultingVaultDisputeStakedAttoRep, uint256 resultingTotalDisputeStakedAttoRep)'

export const LOCAL_DEPOSIT_APPENDED_SIGNATURE = 'LocalDepositAppended(uint256,uint8,address,uint256,uint256,uint256)'

export const LOCAL_DEPOSIT_APPENDED_ABI = 'event LocalDepositAppended(uint256 indexed nodeId, uint8 indexed outcome, address indexed depositor, uint256 attoRepAmount, uint256 parentDepositIndex, uint256 cumulativeRepAmountAttoRep)'

export const ERC20_TRANSFER_SIGNATURE = 'Transfer(address,address,uint256)'

export const ERC20_TRANSFER_ABI = 'event Transfer(address indexed from, address indexed to, uint256 value)'

const VAULT_MIGRATION_SIGNATURE = 'VaultMigrationCheckpoint(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)'

const VAULT_MIGRATION_ABI =
	'event VaultMigrationCheckpoint(address indexed parentPool, address indexed childPool, address indexed vault, uint256 outcomeIndex, uint256 migratedRepDeltaAttoRep, uint256 resultingChildMigratedRepTotalAttoRep, uint256 resultingParentRepBackingUnits, uint256 resultingParentCapacityOwnershipAttoRep, uint256 resultingChildRepBackingUnits, uint256 resultingChildCapacityOwnershipAttoRep, uint256 resultingParentTotalRepBackingUnits, uint256 resultingChildTotalRepBackingUnits, uint256 resultingParentTotalCapacityOwnershipAttoRep, uint256 resultingChildTotalCapacityOwnershipAttoRep, uint256 settlementCollateralTransferredAttoEth, uint256 cumulativeSettlementCollateralTransferredAttoEth)'

export const shareTokenId = (universeId: string, outcome: number) => (amount(universeId) << 8n) | BigInt(outcome)

const compareBigInts = (left: bigint, right: bigint) => {
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

export const compareDecimalStrings = (left: string, right: string) => compareBigInts(BigInt(left), BigInt(right))

export const compareAuctionBids = (left: EcosystemSnapshot['auctions'][number]['bids'][number], right: EcosystemSnapshot['auctions'][number]['bids'][number]) => {
	const tickOrder = compareDecimalStrings(left.tick, right.tick)
	return tickOrder === 0 ? compareDecimalStrings(left.index, right.index) : tickOrder
}

export function lifecycleBatches<T>(values: readonly T[]) {
	return Array.from({ length: Math.ceil(values.length / LIFECYCLE_BATCH_LIMIT) }, (_, index) => values.slice(index * LIFECYCLE_BATCH_LIMIT, (index + 1) * LIFECYCLE_BATCH_LIMIT))
}

export const walletShares = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)

export const forkOutcomesForPool = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => {
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	if (universe === undefined || universe.forkTime === '0') return []
	return validForkOutcomeRoutes(
		snapshot.questions.find(question => question.id === universe.forkQuestionId),
		universe.knownChildOutcomes,
	)
}

export const childPoolForOutcome = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string) => snapshot.pools.find(child => child.parent.toLowerCase() === pool.address.toLowerCase() && child.forkOutcomeIndex === outcome)

const childUniverseForOutcome = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string) => snapshot.universes.find(universe => universe.parentUniverseId === pool.universeId && universe.forkingOutcomeIndex === outcome)

export function childRouteTopologyCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	if (childPoolForOutcome(snapshot, pool, outcome) !== undefined) return undefined
	return topologyMutationCapacityBlocker(snapshot, options, {
		additionalPools: 1,
		additionalUniverses: childUniverseForOutcome(snapshot, pool, outcome) === undefined ? 1 : 0,
		label,
	})
}

export function childUniverseTopologyCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	if (childUniverseForOutcome(snapshot, pool, outcome) !== undefined) return undefined
	return topologyMutationCapacityBlocker(snapshot, options, {
		additionalPools: 0,
		additionalUniverses: 1,
		label,
	})
}

export const operationalPools = (snapshot: EcosystemSnapshot) => snapshot.pools.filter(pool => pool.systemState === 0 && !pool.awaitingForkContinuation && pool.questionOutcome === BINARY_OUTCOME_NONE && snapshot.universes.find(universe => universe.id === pool.universeId)?.forkTime === '0')

export const walletVault = (snapshot: EcosystemSnapshot, pool: PoolSnapshot) => pool.vaults.find(vault => vault.address.toLowerCase() === snapshot.wallet.address.toLowerCase())

export const canDeployOriginPool = (universe: EcosystemSnapshot['universes'][number]) => universe.forkTime === '0' && amount(universe.nonDecisionThresholdAttoRep) > amount(universe.initialEscalationDepositAttoRep)

export function safeOraclePriceDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, prerequisiteCount = 0) {
	if (!pool.oraclePriceValid) return undefined
	const deadline = amount(pool.lastOracleSettlementTimestamp) + ORACLE_PRICE_VALIDITY_SECONDS
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options, prerequisiteCount) ? deadline : undefined
}

export function decodedVaultMigrationEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot, field: 'outcomeIndex' | 'resultingParentRepBackingUnits', expected: string, child?: PoolSnapshot): OperationEvidence {
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

export function decodedChildRepSplitEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string): OperationEvidence {
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

export function feeCheckpointDue(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
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

export function poolAccountingCurrentEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot): OperationEvidence {
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

export function vaultFeeAccountingEvidence(snapshot: EcosystemSnapshot, pool: PoolSnapshot): OperationEvidence[] {
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

export function sharesToEth(pool: PoolSnapshot, attoShares: bigint) {
	return sharesToProjectedEth(pool, attoShares)
}

export function escalationWithdrawalSafe(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	if (pool.escalationNonDecisionState !== 0) return false
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	if (universe === undefined) return false
	const forkTime = amount(universe.forkTime)
	return forkTime === 0n || forkTime >= amount(pool.escalationGameEndTime) || pool.escalationHasReachedNonDecision
}

export function approvePool(snapshot: EcosystemSnapshot, pool: PoolSnapshot, required: bigint) {
	const token = tokenInventory(snapshot, pool.repToken)
	if (allowance(token, pool.address) >= required) return []
	return [poolApprovalStep(snapshot, pool.repToken, pool.address, required)]
}

export function poolApprovalStep(snapshot: EcosystemSnapshot, token: `0x${string}`, pool: `0x${string}`, required: bigint, id = 'approve-rep', label = 'Approve REP for security pool') {
	return encodeStep({ abi: erc20Abi, args: [pool, required], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, pool, required)], functionName: 'approve', id, label, to: token })
}

export function requiredVaultMetadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || value.length === 0) throw new Error(`Vault continuation metadata ${key} is missing`)
	return value
}

export function requiredVaultMetadataAmount(metadata: OperationPlan['metadata'], key: string) {
	const value = requiredVaultMetadataString(metadata, key)
	if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`Vault continuation metadata ${key} is not canonical`)
	return BigInt(value)
}

export function exactPreviousPoolApproval(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, pool: `0x${string}`, required: bigint) {
	const previous = context.previousPlan.steps.find(step => step.id === 'approve-rep')
	if (previous === undefined) return undefined
	const expected = poolApprovalStep(snapshot, token, pool, required)
	return previous.to.toLowerCase() === expected.to.toLowerCase() && previous.data === expected.data ? previous : undefined
}

export function poolApprovalPrepared(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, pool: `0x${string}`, required: bigint) {
	const previous = exactPreviousPoolApproval(snapshot, context, token, pool, required)
	if (context.previousPlan.steps.some(step => step.id === 'approve-rep') && previous === undefined) return false
	if (previous !== undefined && context.confirmedStepIds.includes(previous.id)) return allowance(tokenInventory(snapshot, token), pool) === required
	if (previous === undefined) return allowance(tokenInventory(snapshot, token), pool) >= required
	return true
}

export function poolCleanupPlan(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, pool: `0x${string}`, required: bigint) {
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

export function approveCoordinatorToken(snapshot: EcosystemSnapshot, coordinator: `0x${string}`, tokenAddress: `0x${string}`, required: bigint, id: string, label: string) {
	return encodeStep({ abi: erc20Abi, args: [coordinator, required], evidence: [erc20AllowanceEvidence(tokenAddress, snapshot.wallet.address, coordinator, required)], functionName: 'approve', id, label, to: tokenAddress })
}

export function oracleRequestStagingParameters(pool: PoolSnapshot) {
	const minimumWeth = amount(pool.minimumToken1ReportAttoEth)
	return {
		initialWethAttoEth: minimumWeth > 0n ? minimumWeth : 1n,
		price: amount(pool.lastRepPerEthPrice) > 0n ? amount(pool.lastRepPerEthPrice) : ONE_TOKEN,
	}
}

export type PreparedOracleRequest = {
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

export function oracleRequestInventoryIsFunded(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, prepared: PreparedOracleRequest, transactionCount: number) {
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

export function oracleRequestPreparation(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions): PreparedOracleRequest | undefined {
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

export function exactTokenTransferToCoordinatorEvidence(snapshot: EcosystemSnapshot, token: `0x${string}`, coordinator: `0x${string}`, expected: bigint): OperationEvidence {
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

export function decodedStagedSuccess(coordinator: `0x${string}`): OperationEvidence {
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

export function stagedDownstreamPreflight(pool: PoolSnapshot, staged: EcosystemSnapshot['stagedOperations'][number]) {
	if (staged.operation === 1 || staged.operation === 2) {
		return encodePreflightCall({
			abi: securityPoolAbi,
			args: [staged.operator, amount(staged.amount)],
			caller: staged.coordinator,
			expectedResult: staged.executionExpectedResult,
			functionName: staged.operation === 1 ? 'withdrawRepFromVault' : 'adjustVaultBackingFactor',
			label: `${staged.operation === 1 ? 'withdraw REP' : 'adjust backing target'} for staged operation ${staged.id}`,
			to: pool.address,
		})
	}
	return undefined
}
