import { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationPlan, PlanningOptions, PoolSnapshot } from '../types.ts'

import { approveCoordinatorToken, exactTokenTransferToCoordinatorEvidence, operationalPools, oracleRequestInventoryIsFunded, oracleRequestPreparation, type PreparedOracleRequest } from './planning.ts'

import { ONE_TOKEN, allowance, amount, choose, eligible, encodeStep, erc20AllowanceEvidence, erc20WalletDebit, eventEvidence, mixSeed, optionAmount, planBase, tokenInventory } from '../planning.ts'

import { openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'

import { assertOracleRequestFundingEnvelope, isOracleRequestFundingError, type OracleRequestFundingBounds } from '../oracle-request-funding.ts'

import { getAddress } from '@zoltar/bot-shared/ethereum'

import { maximumFeePerGas } from '@zoltar/bot-shared/execution/transaction-submission'

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
			abi: openOraclePriceCoordinatorAbi,
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

export const requestOraclePrice: OperationDefinition = {
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

export const recoverSettledReport: OperationDefinition = {
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
			steps: [encodeStep({ abi: openOraclePriceCoordinatorAbi, evidence: [eventEvidence(pool.coordinator, 'PendingReportRecovered(uint256,uint256,uint256,uint256,uint256,uint256)')], functionName: 'recoverSettledPendingReport', id: 'recover-report', label: 'Recover settled pending report', to: pool.coordinator })],
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
					steps: [encodeStep({ abi: openOraclePriceCoordinatorAbi, evidence: [eventEvidence(pool.coordinator, 'PendingReportRecovered(uint256,uint256,uint256,uint256,uint256,uint256)')], functionName: 'recoverSettledPendingReport', id: 'recover-report', label: 'Recover settled pending report', to: pool.coordinator })],
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
