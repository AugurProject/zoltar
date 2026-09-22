// Accounting rules published on the generated contract pages. Each value mirrors one Solidity
// constant or rounding choice; tooling/docs/check-docs-example-ownership.mts compares these rules
// with the contract sources so the rendered examples cannot drift from the implementation.

export type RoundingDirection = 'down' | 'up'

export const attoPrecision = 10n ** 18n
const secondsPerDay = 86_400n
const secondsPerYear = 31_536_000

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

export const retentionRules = {
	maxRetentionRate: 999_999_996_848_000_000n,
	minRetentionRate: 999_999_977_880_000_000n,
	dipUtilizationPercent: 80n,
} as const

export const liquidationRules = {
	repBonusBps: 500n,
	bpsDenominator: 10_000n,
	capacityOwnershipRounding: 'down' as RoundingDirection,
	repBackingUnitsRounding: 'up' as RoundingDirection,
} as const

export const auctionRules = {
	minTick: -524_288n,
	maxTick: 524_288n,
	tickBase: '1.0001',
} as const

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
	return { bonusAttoRep, burnAttoRep, haircutPoolAttoRep, payoutAttoRep, rewardEligibleCapAttoRep, rewardPoolAttoRep, scaledPayoutAttoRep }
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
	const whole = attoRep / attoPrecision
	const fraction = (attoRep % attoPrecision).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`
}

export function formatUnderscored(value: bigint): string {
	return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_')
}

// Client-side annualization of a per-second retention factor; the contract never computes this value.
export function annualizedFeePercent(retentionRate: bigint): number {
	const perSecond = Number(retentionRate) / Number(attoPrecision)
	return (1 - perSecond ** secondsPerYear) * 100
}
