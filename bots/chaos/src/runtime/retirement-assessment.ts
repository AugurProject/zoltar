import type { Address, Hash } from '@zoltar/bot-shared/ethereum'
import { buildRetirementLiquidityRemovalPlan } from '../operations/retirement-liquidity.ts'
import type { EcosystemSnapshot, EvaluatedOperation, PlanningOptions } from '../operations/types.ts'
import type { DurableRetirementState, RetirementBlocker, RetirementResidual } from '../state/retirement.ts'
import type { DurableState } from '../state/operator-state.ts'
import type { RetirementAssessment, RetirementProofCounts, V3PositionObservation } from './retirement-types.ts'
import { retirementPlanFromEvaluations } from './retirement-operation-policy.ts'
import { buildAllowanceRevocationPlan, buildAssetSweepPlan, buildNativeOpenOracleCreditPlan, type RetirementSweepLimits } from './retirement-recovery-plans.ts'

function knownApprovalCount(snapshot: EcosystemSnapshot) {
	let count = 0
	for (const token of snapshot.wallet.tokens) {
		count += Object.values(token.allowances).filter(value => BigInt(value) > 0n).length
		if (BigInt(token.openOracleInternalAllowanceToSelf ?? '0') > 0n) count += 1
	}
	count += snapshot.wallet.shares.flatMap(shares => Object.values(shares.isApprovedForAll)).filter(Boolean).length
	count += snapshot.wallet.lpTokens.filter(lp => BigInt(lp.allowanceToRouter) > 0n).length
	return count
}

function retainedAssetResiduals(snapshot: EcosystemSnapshot, retirement: DurableRetirementState): RetirementResidual[] {
	const residuals: RetirementResidual[] = []
	for (const token of snapshot.wallet.tokens) {
		if (BigInt(token.balance) > 0n && (!retirement.policies.sweepAssets || (token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase() && !retirement.policies.unwrapWeth))) {
			residuals.push({ amount: token.balance, asset: token.address, category: 'operator-accepted', reason: retirement.policies.sweepAssets ? 'WETH unwrap was disabled by retirement policy' : 'Reusable-asset sweeping was disabled by retirement policy' })
		}
		if (BigInt(token.openOracleCredit) === 1n) residuals.push({ amount: '1', asset: `${token.address}:OpenOracle`, category: 'mandatory-sentinel', reason: 'OpenOracle retains a mandatory one-unit credit sentinel' })
	}
	if (!retirement.policies.migrateExistingClaims) {
		for (const universe of snapshot.universes.filter(candidate => BigInt(candidate.migrationBalance) > 0n)) {
			residuals.push({ amount: universe.migrationBalance, asset: `migration:${universe.id}`, category: 'irreversible-burn', reason: 'Parent REP was already burned into a migration balance, but claim-linked migration was disabled by retirement policy' })
		}
	}
	if (BigInt(snapshot.wallet.openOracleEthCredit) === 1n) residuals.push({ amount: '1', asset: 'ETH:OpenOracle', category: 'mandatory-sentinel', reason: 'OpenOracle retains a mandatory one-unit native-credit sentinel' })
	return residuals
}

function classifyShares(snapshot: EcosystemSnapshot) {
	const blockers: RetirementBlocker[] = []
	const residuals: RetirementResidual[] = []
	for (const shares of snapshot.wallet.shares) {
		const pool = snapshot.pools.find(candidate => candidate.shareToken.toLowerCase() === shares.shareToken.toLowerCase() && candidate.universeId === shares.universeId)
		const balances = [shares.invalid, shares.yes, shares.no]
		if (balances.every(value => BigInt(value) === 0n)) continue
		if (pool === undefined) {
			blockers.push({ category: 'incomplete-discovery', details: `No canonical pool identity was discovered for outcome shares ${shares.shareToken} in universe ${shares.universeId}`, id: `shares:${shares.shareToken}:${shares.universeId}` })
			continue
		}
		if (pool.questionOutcome === 3) {
			const question = snapshot.questions.find(candidate => candidate.id === pool.questionId)
			const end = question === undefined ? undefined : BigInt(question.endTime)
			blockers.push({ category: 'temporarily-locked', details: 'Outcome shares remain unresolved and cannot yet be classified as winning or losing', id: `shares:${shares.shareToken}:${shares.universeId}`, ...(end === undefined ? {} : { nextEligibleAt: new Date(Number(end) * 1_000).toISOString() }) })
			continue
		}
		for (let outcome = 0; outcome < balances.length; outcome += 1) {
			const balance = balances[outcome]
			if (balance === undefined || BigInt(balance) === 0n) continue
			if (outcome !== pool.questionOutcome) residuals.push({ amount: balance, asset: `${shares.shareToken}:${outcome.toString()}`, category: 'losing-share', reason: 'The canonical pool resolution makes this outcome share nonredeemable' })
			else if (BigInt(pool.shareTokenSupplyAttoShares) === 0n || (BigInt(balance) * BigInt(pool.settlementCollateralAttoEth)) / BigInt(pool.shareTokenSupplyAttoShares) === 0n)
				residuals.push({ amount: balance, asset: `${shares.shareToken}:${outcome.toString()}`, category: 'accepted-dust', reason: 'The canonical winning-share payout rounds to zero' })
		}
	}
	return { blockers, residuals }
}

function canonicalClaimableAssetCount(snapshot: EcosystemSnapshot, retirement: DurableRetirementState) {
	let count = snapshot.wallet.tokens.filter(token => BigInt(token.openOracleCredit) > 1n).length + snapshot.wallet.lpTokens.filter(token => BigInt(token.balance) > 0n).length
	count += snapshot.auctions.filter(auction => BigInt(auction.pendingEthRefund) > 0n).length
	count += (snapshot.forkedCarryWithdrawalPresence ?? snapshot.forkedCarryWithdrawals ?? []).length
	if (BigInt(snapshot.wallet.openOracleEthCredit) > 1n) count += 1
	if (retirement.policies.migrateExistingClaims) count += snapshot.universes.filter(universe => BigInt(universe.migrationBalance) > 0n).length
	for (const pool of snapshot.pools) {
		const vault = pool.vaults.find(candidate => candidate.address.toLowerCase() === snapshot.wallet.address.toLowerCase())
		if (vault !== undefined && BigInt(vault.claimableFeesAttoEth) > 0n) count += 1
		if (vault !== undefined && BigInt(vault.repBackingAttoRep) > 0n && BigInt(vault.disputeStakedAttoRep) === 0n && pool.questionOutcome !== 3 && pool.systemState === 0) count += 1
		const shares = snapshot.wallet.shares.find(candidate => candidate.shareToken.toLowerCase() === pool.shareToken.toLowerCase() && candidate.universeId === pool.universeId)
		if (shares === undefined) continue
		const balances = [BigInt(shares.invalid), BigInt(shares.yes), BigInt(shares.no)]
		if (pool.systemState === 0 && balances.every(value => value > 0n)) count += 1
		const winning = balances[pool.questionOutcome]
		if (pool.systemState === 0 && pool.questionOutcome !== 3 && winning !== undefined && winning > 0n && BigInt(pool.shareTokenSupplyAttoShares) > 0n && (winning * BigInt(pool.settlementCollateralAttoEth)) / BigInt(pool.shareTokenSupplyAttoShares) > 0n) count += 1
	}
	return count
}

export function assessRetirement(parameters: {
	blockHash: Hash
	blockNumber: bigint
	evaluations: readonly EvaluatedOperation[]
	retirement: DurableRetirementState
	snapshot: EcosystemSnapshot
	state: Pick<DurableState, 'obligations' | 'pendingTransactions' | 'workflows'>
	v3: readonly V3PositionObservation[]
	sweepLimits?: RetirementSweepLimits | undefined
	planning?: PlanningOptions | undefined
	canonicalScanComplete: boolean
	/** Ready to act on known current state, independently of historical completeness. */
	executionReady?: boolean
}): RetirementAssessment {
	const executionReady = parameters.executionReady ?? parameters.canonicalScanComplete
	const historyLimited = executionReady && !parameters.canonicalScanComplete
	const unresolvedWorkflows = parameters.state.workflows.filter(workflow => workflow.status !== 'abandoned' && workflow.status !== 'completed')
	const partialWorkflows = unresolvedWorkflows.length
	const actionableObligations = parameters.state.obligations.filter(obligation => !['abandoned', 'completed', 'deferred'].includes(obligation.status)).length
	const fullLiquidityPlan = parameters.planning === undefined ? undefined : buildRetirementLiquidityRemovalPlan(parameters.snapshot, parameters.planning)
	const claimPlan = retirementPlanFromEvaluations(fullLiquidityPlan === undefined ? parameters.evaluations : parameters.evaluations.filter(evaluation => evaluation.plan?.definitionId !== 'trading.liquidity.remove'), parameters.retirement.policies, parameters.snapshot)
	const revocationPlan = buildAllowanceRevocationPlan(parameters.snapshot, Number(parameters.blockNumber & 0xffff_ffffn))
	const nativeCreditPlan = buildNativeOpenOracleCreditPlan(parameters.snapshot, parameters.retirement, Number(parameters.blockNumber & 0xffff_ffffn))
	const sweepPlan = buildAssetSweepPlan(parameters.snapshot, parameters.retirement, Number(parameters.blockNumber & 0xffff_ffffn), parameters.sweepLimits)
	const v3Action = parameters.v3.find(observation => observation.liquidity > 0n || observation.tokensOwed0 > 0n || observation.tokensOwed1 > 0n)
	const approvals = knownApprovalCount(parameters.snapshot)
	const shareClassification = classifyShares(parameters.snapshot)
	const blockers: RetirementBlocker[] = [...parameters.retirement.blockers.filter(blocker => blocker.category === 'ambiguous-position' && blocker.id.startsWith('v3-workflow:')), ...shareClassification.blockers]
	for (const workflow of unresolvedWorkflows.filter(candidate => candidate.classification === 'selectable' && candidate.status === 'failed')) {
		const failure = workflow.steps.find(step => step.status === 'failed')
		blockers.push({
			category: failure?.failureKind === 'semantic-failure' ? 'operator-action' : 'transaction',
			details: failure?.failureKind === 'semantic-failure' ? `${workflow.label} has an unresolved semantic postcondition failure and requires explicit operator reconciliation` : `${workflow.label} has an unresolved transaction failure and requires explicit operator reconciliation`,
			id: workflow.id,
		})
	}
	if (!executionReady) blockers.push({ category: 'incomplete-discovery', details: 'The canonical lifecycle, carry-proof, or topology scan is incomplete', id: 'canonical-scan-incomplete' })
	if (historyLimited) blockers.push({ category: 'incomplete-discovery', details: 'Earlier history is unavailable; recovery covers known claims only.', id: 'unavailable-history' })
	const blockingWarnings = parameters.snapshot.warnings.filter(warning => !historyLimited || !warning.startsWith('Protocol log history is unavailable for blocks '))
	if (blockingWarnings.length !== 0) blockers.push({ category: 'incomplete-discovery', details: blockingWarnings.join('; '), id: 'canonical-scan-warnings' })
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'deferred')) {
		blockers.push({ category: 'temporarily-locked', details: `${obligation.label} is not yet eligible`, id: obligation.id, ...(obligation.notBefore === undefined ? {} : { nextEligibleAt: obligation.notBefore }) })
	}
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'pending')) {
		blockers.push({ category: 'temporarily-locked', details: `${obligation.label} is awaiting its next safe canonical execution`, id: obligation.id, ...(obligation.notBefore === undefined ? {} : { nextEligibleAt: obligation.notBefore }) })
	}
	for (const obligation of parameters.state.obligations.filter(candidate => candidate.status === 'blocked' || candidate.status === 'failed')) {
		blockers.push({ category: 'operator-action', details: obligation.blockers[0] ?? `${obligation.label} requires reconciliation`, id: obligation.id })
	}
	for (const position of parameters.retirement.positions.filter(candidate => candidate.status === 'blocked')) blockers.push({ category: 'ambiguous-position', details: `Ownership could not be proven for ${position.pool}`, id: position.id })
	for (const position of parameters.retirement.positions.filter(candidate => candidate.status === 'pending-confirmation')) blockers.push({ category: 'ambiguous-position', details: `Position ${position.id} is awaiting canonical pool and ownership verification`, id: position.id })
	const residuals = [...shareClassification.residuals, ...retainedAssetResiduals(parameters.snapshot, parameters.retirement)]
	const canonicalClaims = canonicalClaimableAssetCount(parameters.snapshot, parameters.retirement)
	if (canonicalClaims > 0 && claimPlan === undefined && nativeCreditPlan === undefined) blockers.push({ category: 'operator-action', details: 'Canonical claimable assets exist but no safe retirement plan is currently executable', id: 'claimable-assets-without-plan' })
	const proof: RetirementProofCounts = {
		actionableObligations,
		claimableAssets: canonicalClaims,
		collectableV3Positions: parameters.v3.filter(value => value.tokensOwed0 > 0n || value.tokensOwed1 > 0n).length,
		knownApprovals: approvals,
		ownedLiquidityPositions: parameters.v3.filter(value => value.liquidity > 0n).length,
		partialWorkflows,
		pendingTransactions: parameters.state.pendingTransactions.length,
	}
	const recoveryPlan = claimPlan ?? fullLiquidityPlan ?? revocationPlan ?? nativeCreditPlan
	const operationalBlockers = blockers.filter(blocker => blocker.id !== 'unavailable-history')
	const directPlan = recoveryPlan ?? (canonicalClaims === 0 && operationalBlockers.length === 0 && actionableObligations === 0 && partialWorkflows === 0 && parameters.state.pendingTransactions.length === 0 ? sweepPlan : undefined)
	let action: RetirementAssessment['action']
	if (executionReady && v3Action !== undefined) action = { kind: 'v3-position', observation: v3Action }
	else if (executionReady && directPlan !== undefined) action = { kind: 'existing-plan', plan: directPlan }
	const outstanding = proof.actionableObligations + proof.claimableAssets + proof.collectableV3Positions + proof.knownApprovals + proof.ownedLiquidityPositions + proof.partialWorkflows + proof.pendingTransactions
	if (action !== undefined) return { action, blockers, proof, residuals, status: 'draining' }
	if (operationalBlockers.some(blocker => blocker.category !== 'temporarily-locked')) return { action, blockers, proof, residuals, status: 'blocked' }
	if (operationalBlockers.length !== 0) return { action, blockers, proof, residuals, status: 'waiting' }
	if (outstanding > 0) return { action, blockers, proof, residuals, status: 'draining' }
	if (parameters.sweepLimits !== undefined && BigInt(parameters.snapshot.wallet.ethBalanceAttoEth) > 0n) residuals.push({ amount: parameters.snapshot.wallet.ethBalanceAttoEth, asset: 'ETH', category: 'mandatory-sentinel', reason: 'Configured ETH reserve and final-sweep gas budget retained after native sweeping' })
	if (historyLimited) return { action, blockers, proof, residuals, status: 'known-claims-recovered' }
	return { action, blockers, proof, residuals, status: residuals.length === 0 ? 'drained' : 'drained-with-residuals' }
}

export type RetirementCompletionBinding = {
	profileId: string
	scannedWallet: Address
	signerAddress: Address | undefined
}

export function applyRetirementAssessment(retirement: DurableRetirementState, assessment: RetirementAssessment, blockHash: Hash, blockNumber: bigint, binding: RetirementCompletionBinding, now = new Date().toISOString()) {
	const terminal = assessment.status === 'drained' || assessment.status === 'drained-with-residuals'
	const completionSigner = binding.signerAddress
	if (terminal) {
		if (completionSigner === undefined) throw new Error('Retirement completion requires a bound signer')
		if (completionSigner.toLowerCase() !== binding.scannedWallet.toLowerCase()) throw new Error('Retirement completion scan wallet does not match the bound signer')
		const outstanding = assessment.proof.actionableObligations + assessment.proof.claimableAssets + assessment.proof.collectableV3Positions + assessment.proof.knownApprovals + assessment.proof.ownedLiquidityPositions + assessment.proof.partialWorkflows + assessment.proof.pendingTransactions
		if (outstanding !== 0) throw new Error('Retirement completion requires every canonical proof count to be zero')
	}
	retirement.blockers = assessment.blockers
	retirement.status = assessment.status
	retirement.updatedAt = now
	retirement.profileReplacementOverride = undefined
	if (!terminal) {
		retirement.completionEvidence = undefined
		return
	}
	if (completionSigner === undefined) throw new Error('Retirement completion requires a bound signer')
	retirement.completionEvidence = {
		blockHash,
		blockNumber: blockNumber.toString(),
		completedAt: now,
		profileId: binding.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: assessment.residuals,
		signerAddress: completionSigner,
	}
}
