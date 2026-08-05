export type EscalationOutcomeKey = 'invalid' | 'yes' | 'no'
export type EscalationBalanceTuple = readonly [invalidBalanceAttoRep: bigint, yesBalanceAttoRep: bigint, noBalanceAttoRep: bigint]
export type ProjectedEscalationDeposit = {
	acceptedAmountAttoRep: bigint
	projectedBalancesAttoRep: EscalationBalanceTuple
	reachesNonDecision: boolean
}

export const ESCALATION_TIME_LENGTH = 4233600n

const SCALE = 1000000n
const LN2_SCALED = 693147n
const MAX_ATANH_ITERATIONS = 16

export function getEscalationBindingCapitalAttoRep(balancesAttoRep: EscalationBalanceTuple) {
	const [invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep] = balancesAttoRep
	if ((invalidBalanceAttoRep >= yesBalanceAttoRep && invalidBalanceAttoRep <= noBalanceAttoRep) || (invalidBalanceAttoRep >= noBalanceAttoRep && invalidBalanceAttoRep <= yesBalanceAttoRep)) return invalidBalanceAttoRep
	if ((yesBalanceAttoRep >= invalidBalanceAttoRep && yesBalanceAttoRep <= noBalanceAttoRep) || (yesBalanceAttoRep >= noBalanceAttoRep && yesBalanceAttoRep <= invalidBalanceAttoRep)) return yesBalanceAttoRep
	return noBalanceAttoRep
}

function computeAtanhScaled(z: bigint) {
	const z2 = (z * z) / SCALE
	let term = z
	let atanhScaled = term
	for (let iteration = 1; iteration < MAX_ATANH_ITERATIONS; iteration += 1) {
		term = (term * z2 * BigInt(2 * iteration - 1)) / (BigInt(2 * iteration + 1) * SCALE)
		if (term === 0n) break
		atanhScaled += term
	}
	return atanhScaled
}

function computeLnRatioScaled(lowValue: bigint, highValue: bigint) {
	let normalizedLow = lowValue
	let log2Count = 0n
	while (highValue >= normalizedLow * 2n) {
		normalizedLow *= 2n
		log2Count += 1n
	}
	const diff = highValue - normalizedLow
	const sum = highValue + normalizedLow
	const z = (diff * SCALE) / sum
	if (z === 0n) return log2Count * LN2_SCALED
	return log2Count * LN2_SCALED + 2n * computeAtanhScaled(z)
}

export function computeEscalationTimeSinceStartFromAttritionCostAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, attritionCostAttoRep: bigint) {
	if (attritionCostAttoRep <= startBondAttoRep) return 0n
	if (attritionCostAttoRep >= nonDecisionThresholdAttoRep) return ESCALATION_TIME_LENGTH
	const lnRatioScaled = computeLnRatioScaled(startBondAttoRep, nonDecisionThresholdAttoRep)
	if (lnRatioScaled === 0n) return 0n
	const lnCostRatioScaled = computeLnRatioScaled(startBondAttoRep, attritionCostAttoRep)
	return (lnCostRatioScaled * ESCALATION_TIME_LENGTH) / lnRatioScaled
}

function getEscalationOutcomeIndex(outcome: EscalationOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0
		case 'yes':
			return 1
		case 'no':
			return 2
		default:
			throw new Error(`Unhandled discriminated union member: "${String(outcome)}"`)
	}
}

function getMaxEscalationBalanceAttoRep(balancesAttoRep: EscalationBalanceTuple) {
	const [invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep] = balancesAttoRep
	if (invalidBalanceAttoRep > yesBalanceAttoRep) {
		if (invalidBalanceAttoRep > noBalanceAttoRep) return invalidBalanceAttoRep
		return noBalanceAttoRep
	}
	if (yesBalanceAttoRep > noBalanceAttoRep) return yesBalanceAttoRep
	return noBalanceAttoRep
}

export function hasReachedNonDecision(balancesAttoRep: EscalationBalanceTuple, nonDecisionThresholdAttoRep: bigint) {
	let thresholdHits = 0
	if (balancesAttoRep[0] >= nonDecisionThresholdAttoRep) thresholdHits += 1
	if (balancesAttoRep[1] >= nonDecisionThresholdAttoRep) thresholdHits += 1
	if (balancesAttoRep[2] >= nonDecisionThresholdAttoRep) thresholdHits += 1
	return thresholdHits >= 2
}

function setBalanceAtIndex(balancesAttoRep: EscalationBalanceTuple, index: number, valueAttoRep: bigint): EscalationBalanceTuple {
	switch (index) {
		case 0:
			return [valueAttoRep, balancesAttoRep[1], balancesAttoRep[2]]
		case 1:
			return [balancesAttoRep[0], valueAttoRep, balancesAttoRep[2]]
		case 2:
			return [balancesAttoRep[0], balancesAttoRep[1], valueAttoRep]
		default:
			throw new RangeError(`Unknown escalation balance index: ${index.toString()}`)
	}
}

export function projectEscalationDeposit({
	amountAttoRep,
	balancesAttoRep,
	nonDecisionThresholdAttoRep,
	outcome,
	startBondAttoRep,
}: {
	amountAttoRep: bigint
	balancesAttoRep: EscalationBalanceTuple
	nonDecisionThresholdAttoRep: bigint
	outcome: EscalationOutcomeKey
	startBondAttoRep: bigint
}): ProjectedEscalationDeposit | undefined {
	if (amountAttoRep < startBondAttoRep) return undefined
	const outcomeIndex = getEscalationOutcomeIndex(outcome)
	const currentBalanceAttoRep = balancesAttoRep[outcomeIndex]
	if (currentBalanceAttoRep >= nonDecisionThresholdAttoRep) return undefined
	const roomAttoRep = nonDecisionThresholdAttoRep - currentBalanceAttoRep
	let acceptedAmountAttoRep = amountAttoRep > roomAttoRep ? roomAttoRep : amountAttoRep
	let newBalanceAttoRep = currentBalanceAttoRep + acceptedAmountAttoRep
	const maxBalanceAttoRep = getMaxEscalationBalanceAttoRep(balancesAttoRep)
	const otherHasMax = (() => {
		if (outcomeIndex === 0) return balancesAttoRep[1] === maxBalanceAttoRep || balancesAttoRep[2] === maxBalanceAttoRep
		if (outcomeIndex === 1) return balancesAttoRep[0] === maxBalanceAttoRep || balancesAttoRep[2] === maxBalanceAttoRep
		return balancesAttoRep[0] === maxBalanceAttoRep || balancesAttoRep[1] === maxBalanceAttoRep
	})()
	if (newBalanceAttoRep === maxBalanceAttoRep && otherHasMax && maxBalanceAttoRep < nonDecisionThresholdAttoRep) {
		acceptedAmountAttoRep -= 1n
		if (acceptedAmountAttoRep < startBondAttoRep) return undefined
		newBalanceAttoRep = currentBalanceAttoRep + acceptedAmountAttoRep
	}
	const projectedBalancesAttoRep = setBalanceAtIndex(balancesAttoRep, outcomeIndex, newBalanceAttoRep)
	return {
		acceptedAmountAttoRep,
		projectedBalancesAttoRep,
		reachesNonDecision: hasReachedNonDecision(projectedBalancesAttoRep, nonDecisionThresholdAttoRep),
	}
}

function getWinningWithdrawalAmount({
	bindingCapitalAttoRep,
	depositAmountAttoRep,
	depositEndAttoRep,
	depositStartAttoRep,
	forkThresholdAttoRep,
	nonDecisionThresholdAttoRep,
	winningOutcomeBalanceAttoRep,
}: {
	bindingCapitalAttoRep: bigint
	depositAmountAttoRep: bigint
	depositEndAttoRep: bigint
	depositStartAttoRep: bigint
	forkThresholdAttoRep: bigint
	nonDecisionThresholdAttoRep: bigint
	winningOutcomeBalanceAttoRep: bigint
}) {
	const rewardEligibleCapAttoRep = bindingCapitalAttoRep + bindingCapitalAttoRep / 2n
	const rewardEligiblePrincipalAttoRep = winningOutcomeBalanceAttoRep < rewardEligibleCapAttoRep ? winningOutcomeBalanceAttoRep : rewardEligibleCapAttoRep
	let amountToWithdrawAttoRep: bigint
	if (rewardEligiblePrincipalAttoRep === 0n) {
		amountToWithdrawAttoRep = depositAmountAttoRep
	} else {
		const eligibleEndAttoRep = depositEndAttoRep < rewardEligibleCapAttoRep ? depositEndAttoRep : rewardEligibleCapAttoRep
		const rewardEligibleDepositAttoRep = eligibleEndAttoRep > depositStartAttoRep ? eligibleEndAttoRep - depositStartAttoRep : 0n
		const cappedRewardEligibleDepositAttoRep = rewardEligibleDepositAttoRep > depositAmountAttoRep ? depositAmountAttoRep : rewardEligibleDepositAttoRep
		const rewardBonusPoolAttoRep = (bindingCapitalAttoRep * 3n) / 5n
		const bonusAttoRep = (cappedRewardEligibleDepositAttoRep * rewardBonusPoolAttoRep) / rewardEligiblePrincipalAttoRep
		amountToWithdrawAttoRep = depositAmountAttoRep + bonusAttoRep
	}
	if (forkThresholdAttoRep < nonDecisionThresholdAttoRep) return (amountToWithdrawAttoRep * forkThresholdAttoRep) / nonDecisionThresholdAttoRep
	return amountToWithdrawAttoRep
}

export function getWinningEscalationDepositClaimAmount({
	bindingCapitalAttoRep,
	depositAmountAttoRep,
	cumulativeAmountAttoRep,
	forkThresholdAttoRep,
	nonDecisionThresholdAttoRep,
	winningOutcomeBalanceAttoRep,
}: {
	bindingCapitalAttoRep: bigint
	depositAmountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	forkThresholdAttoRep: bigint
	nonDecisionThresholdAttoRep: bigint
	winningOutcomeBalanceAttoRep: bigint
}) {
	return getWinningWithdrawalAmount({
		bindingCapitalAttoRep,
		depositAmountAttoRep,
		depositEndAttoRep: cumulativeAmountAttoRep,
		depositStartAttoRep: cumulativeAmountAttoRep - depositAmountAttoRep,
		forkThresholdAttoRep,
		nonDecisionThresholdAttoRep,
		winningOutcomeBalanceAttoRep,
	})
}

export function getWinningImportedEscalationDepositClaimAmount({
	bindingCapitalAttoRep,
	depositAmountAttoRep,
	postDepositCumulativeAmountAttoRep,
	forkThresholdAttoRep,
	nonDecisionThresholdAttoRep,
	winningOutcomeBalanceAttoRep,
}: {
	bindingCapitalAttoRep: bigint
	depositAmountAttoRep: bigint
	postDepositCumulativeAmountAttoRep: bigint
	forkThresholdAttoRep: bigint
	nonDecisionThresholdAttoRep: bigint
	winningOutcomeBalanceAttoRep: bigint
}) {
	return getWinningWithdrawalAmount({
		bindingCapitalAttoRep,
		depositAmountAttoRep,
		depositEndAttoRep: postDepositCumulativeAmountAttoRep,
		depositStartAttoRep: postDepositCumulativeAmountAttoRep - depositAmountAttoRep,
		forkThresholdAttoRep,
		nonDecisionThresholdAttoRep,
		winningOutcomeBalanceAttoRep,
	})
}
