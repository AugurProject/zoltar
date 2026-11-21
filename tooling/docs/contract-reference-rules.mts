// Accounting rules published on the generated contract pages. Each value mirrors one Solidity
// constant or rounding choice; tooling/docs/check-docs-example-ownership.mts compares these rules
// with the contract sources so the rendered examples cannot drift from the implementation.

import { formatUnits } from '@zoltar/core-shared/evm/ethereum'

export const attoPrecision = 10n ** 18n
const secondsPerDay = 86_400n

export const escalationRules = {
	activationDays: 3n,
	escalationDays: 49n,
	excessRewardWindowDivisor: 2n,
	rewardPoolNumerator: 3n,
	haircutPoolNumerator: 2n,
	poolDenominator: 5n,
} as const

export const escalationTimeLengthSeconds = escalationRules.escalationDays * secondsPerDay
export const escalationFinalDay = escalationRules.activationDays + escalationRules.escalationDays

export type EscalationPayoutInput = {
	bindingCapitalAttoRep: bigint
	winningOutcomeBalanceAttoRep: bigint
	depositAmountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	nonDecisionThresholdAttoRep: bigint
	actualForkThresholdAttoRep: bigint
}

export type EscalationPayout = {
	rewardEligibleCapAttoRep: bigint
	rewardEligiblePrincipalAttoRep: bigint
	rewardPoolAttoRep: bigint
	haircutPoolAttoRep: bigint
	bonusAttoRep: bigint
	burnAttoRep: bigint
	payoutAttoRep: bigint
	scaledPayoutAttoRep: bigint
}

// Ordinary settlement takes differences of cumulative allocations, including fork scaling.
export function computeOrdinaryWinningWithdrawal(input: EscalationPayoutInput, rules = escalationRules): EscalationPayout {
	const rewardEligibleCapAttoRep = input.bindingCapitalAttoRep + input.bindingCapitalAttoRep / rules.excessRewardWindowDivisor
	const rewardPoolAttoRep = (input.bindingCapitalAttoRep * rules.rewardPoolNumerator) / rules.poolDenominator
	const haircutPoolAttoRep = (input.bindingCapitalAttoRep * rules.haircutPoolNumerator) / rules.poolDenominator
	const rewardEligiblePrincipalAttoRep = input.winningOutcomeBalanceAttoRep < rewardEligibleCapAttoRep ? input.winningOutcomeBalanceAttoRep : rewardEligibleCapAttoRep
	const prefix = (principal: bigint) => {
		const eligible = principal < rewardEligibleCapAttoRep ? principal : rewardEligibleCapAttoRep
		const bonus = rewardEligiblePrincipalAttoRep === 0n ? 0n : (eligible * rewardPoolAttoRep) / rewardEligiblePrincipalAttoRep
		const burn = rewardEligiblePrincipalAttoRep === 0n ? 0n : (eligible * haircutPoolAttoRep) / rewardEligiblePrincipalAttoRep
		const payout = principal + bonus
		const scaledPayout = input.actualForkThresholdAttoRep < input.nonDecisionThresholdAttoRep ? (payout * input.actualForkThresholdAttoRep) / input.nonDecisionThresholdAttoRep : payout
		return { bonus, burn, payout, scaledPayout }
	}
	const end = prefix(input.cumulativeAmountAttoRep)
	const start = prefix(input.cumulativeAmountAttoRep - input.depositAmountAttoRep)
	return {
		bonusAttoRep: end.bonus - start.bonus,
		burnAttoRep: end.burn - start.burn,
		payoutAttoRep: end.payout - start.payout,
		scaledPayoutAttoRep: end.scaledPayout - start.scaledPayout,
		haircutPoolAttoRep,
		rewardEligibleCapAttoRep,
		rewardEligiblePrincipalAttoRep,
		rewardPoolAttoRep,
	}
}

export const escalationPayoutExample: EscalationPayoutInput = {
	bindingCapitalAttoRep: 10n * attoPrecision,
	winningOutcomeBalanceAttoRep: 15n * attoPrecision,
	depositAmountAttoRep: 5n * attoPrecision,
	cumulativeAmountAttoRep: 15n * attoPrecision,
	nonDecisionThresholdAttoRep: 20n * attoPrecision,
	actualForkThresholdAttoRep: 16n * attoPrecision,
}

// Renders an attoREP amount as REP with trailing zeros removed, keeping full precision otherwise.
export function formatRep(attoRep: bigint): string {
	return formatUnits(attoRep, 18)
}
