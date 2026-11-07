import type { EcosystemSnapshot, OperationDefinition } from '../types.ts'
import { choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'
import { BINARY_OUTCOME_NONE, compareDecimalStrings, escalationWithdrawalSafe, lifecycleBatches } from './planning.ts'
import { securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'

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

export const withdrawEscalation: OperationDefinition = {
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
		return eligible(escalationWithdrawalCandidates(snapshot).length > 0 ? undefined : 'No resolved wallet escalation deposit is withdrawable')
	},
	id: 'statoblast.escalation.withdraw',
	label: 'Withdraw escalation deposits',
	method: 'withdrawFromEscalationGame',
	risk: 'low',
}
