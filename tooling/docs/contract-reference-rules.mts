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

// Port of EscalationGameProofVerifier.computeWinningWithdrawal with the reward and haircut pools exposed.
export function computeWinningWithdrawal(input: EscalationPayoutInput, rules = escalationRules): EscalationPayout {
	const rewardEligibleCapAttoRep = input.bindingCapitalAttoRep + input.bindingCapitalAttoRep / rules.excessRewardWindowDivisor
	const rewardPoolAttoRep = (input.bindingCapitalAttoRep * rules.rewardPoolNumerator) / rules.poolDenominator
	const haircutPoolAttoRep = (input.bindingCapitalAttoRep * rules.haircutPoolNumerator) / rules.poolDenominator
	const rewardEligiblePrincipalAttoRep = input.winningOutcomeBalanceAttoRep < rewardEligibleCapAttoRep ? input.winningOutcomeBalanceAttoRep : rewardEligibleCapAttoRep
	let bonusAttoRep = 0n
	let burnAttoRep = 0n
	if (rewardEligiblePrincipalAttoRep > 0n) {
		const depositStartAttoRep = input.cumulativeAmountAttoRep - input.depositAmountAttoRep
		const eligibleEndAttoRep = input.cumulativeAmountAttoRep < rewardEligibleCapAttoRep ? input.cumulativeAmountAttoRep : rewardEligibleCapAttoRep
		let rewardEligibleDepositAttoRep = eligibleEndAttoRep > depositStartAttoRep ? eligibleEndAttoRep - depositStartAttoRep : 0n
		if (rewardEligibleDepositAttoRep > input.depositAmountAttoRep) rewardEligibleDepositAttoRep = input.depositAmountAttoRep
		bonusAttoRep = (rewardEligibleDepositAttoRep * rewardPoolAttoRep) / rewardEligiblePrincipalAttoRep
		burnAttoRep = (rewardEligibleDepositAttoRep * haircutPoolAttoRep) / rewardEligiblePrincipalAttoRep
	}
	const payoutAttoRep = input.depositAmountAttoRep + bonusAttoRep
	const scaledPayoutAttoRep = input.actualForkThresholdAttoRep < input.nonDecisionThresholdAttoRep ? (payoutAttoRep * input.actualForkThresholdAttoRep) / input.nonDecisionThresholdAttoRep : payoutAttoRep
	return { bonusAttoRep, burnAttoRep, haircutPoolAttoRep, payoutAttoRep, rewardEligibleCapAttoRep, rewardEligiblePrincipalAttoRep, rewardPoolAttoRep, scaledPayoutAttoRep }
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
