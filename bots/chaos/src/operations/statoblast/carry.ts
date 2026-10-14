import { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions, PoolSnapshot } from '../types.ts'

import { amount, choose, eligible, encodePreflightCall, encodeStep, eventEvidence, eventTopic, mixSeed, planBase } from '../planning.ts'

import { escalationGameAbi, multicall3Abi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'

import { CARRY_DEPOSIT_CONSUMED_ABI, CARRY_DEPOSIT_CONSUMED_SIGNATURE, CLAIM_DEPOSIT_ABI, CLAIM_DEPOSIT_SIGNATURE } from './planning.ts'

import { claimCheckpointArguments, claimCheckpointWithdrawalCalls } from './checkpoint-call.ts'

import { walletVaultRegistrationCapacityBlocker } from './vaults.ts'

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

export const sweepResidualEscalation: OperationDefinition = {
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
		carryField('amountAttoRep', candidate.amountAttoRep),
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

export const withdrawForkedCarry: OperationDefinition = {
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
	discoveryInputs: ['anchored contract storage', 'snapshot MMR proof', 'sparse nullifier proof', 'anchored source/child graph and direct-claim state'],
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

const checkpointMetadata = (candidate: NonNullable<EcosystemSnapshot['forkedClaimCheckpoints']>[number]) => ({
	...forkedCarryMetadata(candidate),
	nextSourceGame: candidate.nextSourceGame,
	pendingSteps: candidate.pendingSteps,
	pendingCommitment: candidate.pendingCommitment,
	...(candidate.finalWithdrawal === undefined ? {} : { withdraws: true }),
})

function checkpointPlan(snapshot: EcosystemSnapshot, candidate: NonNullable<EcosystemSnapshot['forkedClaimCheckpoints']>[number]) {
	const final = candidate.finalWithdrawal
	if (final !== undefined && final.proof.depositor.toLowerCase() !== snapshot.wallet.address.toLowerCase()) throw new Error('Final checkpoint withdrawal recipient differs from authenticated wallet')
	const checkpointEvidence = [eventEvidence(candidate.game, 'ClaimCheckpointProgress(bytes32,address,uint256,bool)')]
	const step =
		final === undefined
			? encodeStep({ abi: escalationGameAbi, args: claimCheckpointArguments(candidate), functionName: 'processClaimCheckpoint', id: 'prepare-inherited-claim', label: 'Prepare up to eight ancestry steps', to: candidate.game, evidence: checkpointEvidence })
			: encodeStep({
					abi: multicall3Abi,
					args: [claimCheckpointWithdrawalCalls(candidate)],
					functionName: 'aggregate3',
					id: 'prepare-and-withdraw-inherited-claim',
					label: 'Finish preparation and withdraw inherited deposit',
					to: final.multicall3,
					evidence: [
						...checkpointEvidence,
						...[
							{ field: 'resultingNullifierRoot', equals: final.resultingNullifierRoot },
							{ field: 'resultingCarryRoot', equals: final.resultingCarryRoot },
							{ field: 'amountAttoRep', equals: candidate.amountAttoRep },
							{ field: 'reason', equals: 0 },
						].map(value => ({
							...value,
							abi: CARRY_DEPOSIT_CONSUMED_ABI,
							emitter: candidate.game,
							indexed: { depositor: final.proof.depositor, parentDepositIndex: candidate.parentDepositIndex, sourceNodeId: candidate.sourceNodeId },
							kind: 'decoded-event-field' as const,
							signature: CARRY_DEPOSIT_CONSUMED_SIGNATURE,
							topic0: eventTopic(CARRY_DEPOSIT_CONSUMED_SIGNATURE),
						})),
					],
					preflightCalls: [
						encodePreflightCall({ abi: multicall3Abi, args: [claimCheckpointWithdrawalCalls(candidate)], functionName: 'aggregate3', caller: snapshot.wallet.address, expectedResult: final.preflightExpectedResult, label: 'Revalidate final preparation and inherited withdrawal atomically', to: final.multicall3 }),
					],
				})
	return planBase({
		definitionId: prepareInheritedClaim.id,
		ecosystem: 'statoblast',
		label: prepareInheritedClaim.label,
		metadata: checkpointMetadata(candidate),
		priority: 'urgent',
		risk: 'low',
		snapshot,
		postconditions: [final === undefined ? 'A bounded checkpoint progresses without consuming or transferring the inherited deposit' : 'The final checkpoint and authenticated depositor withdrawal complete atomically'],
		...(final === undefined ? {} : { lastValidBlockNumber: (amount(snapshot.anchor.blockNumber) + 1n).toString() }),
		steps: [step],
	})
}

export const prepareInheritedClaim: OperationDefinition = {
	id: 'statoblast.escalation.prepare-claim',
	method: 'processClaimCheckpoint',
	contract: 'EscalationGameClaimDelegate',
	classification: 'lifecycle-obligation',
	ecosystem: 'statoblast',
	risk: 'low',
	label: 'Prepare inherited claim',
	description: 'Processes up to eight ancestry steps, combining final preparation with an authenticated inherited withdrawal when both calls simulate successfully.',
	discoveryInputs: ['anchored inherited proof', 'canonical claim checkpoint readiness'],
	buildPlan(snapshot, options) {
		const candidate = choose(snapshot.forkedClaimCheckpoints ?? [], mixSeed(options.seed, prepareInheritedClaim.id))
		return candidate === undefined ? undefined : checkpointPlan(snapshot, candidate)
	},
	buildLifecyclePlans: snapshot => (snapshot.forkedClaimCheckpoints ?? []).map(candidate => checkpointPlan(snapshot, candidate)),
	enumerateLifecyclePresence: snapshot => (snapshot.forkedClaimCheckpoints ?? []).map(checkpointMetadata),
	enumerateLifecycleObstructingPresence: snapshot => (snapshot.forkedClaimCheckpoints ?? []).map(checkpointMetadata),
	evaluate: snapshot => eligible((snapshot.forkedClaimCheckpoints?.length ?? 0) > 0 ? undefined : 'No inherited claim needs ancestry preparation'),
}
