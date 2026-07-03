export type EscalationOutcomeKey = 'invalid' | 'yes' | 'no'
export type EscalationBalanceTuple = readonly [bigint, bigint, bigint]
export type ProjectedEscalationDeposit = {
	acceptedAmount: bigint
	projectedBalances: EscalationBalanceTuple
	reachesNonDecision: boolean
}

export const ESCALATION_TIME_LENGTH = 4233600n

const SCALE = 1000000n
const LN2_SCALED = 693147n
const MAX_ATANH_ITERATIONS = 16

export function getEscalationBindingCapital(balances: EscalationBalanceTuple) {
	const [invalidBalance, yesBalance, noBalance] = balances
	if ((invalidBalance >= yesBalance && invalidBalance <= noBalance) || (invalidBalance >= noBalance && invalidBalance <= yesBalance)) return invalidBalance
	if ((yesBalance >= invalidBalance && yesBalance <= noBalance) || (yesBalance >= noBalance && yesBalance <= invalidBalance)) return yesBalance
	return noBalance
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
	if (z === 0n) return 0n
	return log2Count * LN2_SCALED + 2n * computeAtanhScaled(z)
}

export function computeEscalationTimeSinceStartFromAttritionCost(startBond: bigint, nonDecisionThreshold: bigint, attritionCost: bigint) {
	if (attritionCost <= startBond) return 0n
	if (attritionCost >= nonDecisionThreshold) return ESCALATION_TIME_LENGTH
	const lnRatioScaled = computeLnRatioScaled(startBond, nonDecisionThreshold)
	if (lnRatioScaled === 0n) return 0n
	const lnCostRatioScaled = computeLnRatioScaled(startBond, attritionCost)
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

function getMaxEscalationBalance(balances: EscalationBalanceTuple) {
	const [invalidBalance, yesBalance, noBalance] = balances
	if (invalidBalance > yesBalance) {
		if (invalidBalance > noBalance) return invalidBalance
		return noBalance
	}
	if (yesBalance > noBalance) return yesBalance
	return noBalance
}

export function hasReachedNonDecision(balances: EscalationBalanceTuple, nonDecisionThreshold: bigint) {
	let thresholdHits = 0
	if (balances[0] >= nonDecisionThreshold) thresholdHits += 1
	if (balances[1] >= nonDecisionThreshold) thresholdHits += 1
	if (balances[2] >= nonDecisionThreshold) thresholdHits += 1
	return thresholdHits >= 2
}

function setBalanceAtIndex(balances: EscalationBalanceTuple, index: number, value: bigint): EscalationBalanceTuple {
	switch (index) {
		case 0:
			return [value, balances[1], balances[2]]
		case 1:
			return [balances[0], value, balances[2]]
		case 2:
			return [balances[0], balances[1], value]
		default:
			throw new RangeError(`Unknown escalation balance index: ${index.toString()}`)
	}
}

export function projectEscalationDeposit({ amount, balances, nonDecisionThreshold, outcome, startBond }: { amount: bigint; balances: EscalationBalanceTuple; nonDecisionThreshold: bigint; outcome: EscalationOutcomeKey; startBond: bigint }): ProjectedEscalationDeposit | undefined {
	if (amount < startBond) return undefined
	const outcomeIndex = getEscalationOutcomeIndex(outcome)
	const currentBalance = balances[outcomeIndex]
	if (currentBalance >= nonDecisionThreshold) return undefined
	const room = nonDecisionThreshold - currentBalance
	let acceptedAmount = amount > room ? room : amount
	let newBalance = currentBalance + acceptedAmount
	const maxBalance = getMaxEscalationBalance(balances)
	const otherHasMax = (() => {
		if (outcomeIndex === 0) return balances[1] === maxBalance || balances[2] === maxBalance
		if (outcomeIndex === 1) return balances[0] === maxBalance || balances[2] === maxBalance
		return balances[0] === maxBalance || balances[1] === maxBalance
	})()
	if (newBalance === maxBalance && otherHasMax && maxBalance < nonDecisionThreshold) {
		acceptedAmount -= 1n
		if (acceptedAmount < startBond) return undefined
		newBalance = currentBalance + acceptedAmount
	}
	const projectedBalances = setBalanceAtIndex(balances, outcomeIndex, newBalance)
	return {
		acceptedAmount,
		projectedBalances,
		reachesNonDecision: hasReachedNonDecision(projectedBalances, nonDecisionThreshold),
	}
}

function getWinningWithdrawalAmount({
	bindingCapital,
	depositAmount,
	depositEnd,
	depositStart,
	forkThreshold,
	nonDecisionThreshold,
	winningOutcomeBalance,
}: {
	bindingCapital: bigint
	depositAmount: bigint
	depositEnd: bigint
	depositStart: bigint
	forkThreshold: bigint
	nonDecisionThreshold: bigint
	winningOutcomeBalance: bigint
}) {
	const rewardEligibleCapAmount = bindingCapital + bindingCapital / 2n
	const rewardEligiblePrincipalAmount = winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount
	let amountToWithdraw: bigint
	if (rewardEligiblePrincipalAmount === 0n) {
		amountToWithdraw = depositAmount
	} else {
		const eligibleEndAmount = depositEnd < rewardEligibleCapAmount ? depositEnd : rewardEligibleCapAmount
		const rewardEligibleDepositAmount = eligibleEndAmount > depositStart ? eligibleEndAmount - depositStart : 0n
		const cappedRewardEligibleDepositAmount = rewardEligibleDepositAmount > depositAmount ? depositAmount : rewardEligibleDepositAmount
		const rewardBonusPoolAmount = (bindingCapital * 3n) / 5n
		const bonusShare = (cappedRewardEligibleDepositAmount * rewardBonusPoolAmount) / rewardEligiblePrincipalAmount
		amountToWithdraw = depositAmount + bonusShare
	}
	if (forkThreshold < nonDecisionThreshold) return (amountToWithdraw * forkThreshold) / nonDecisionThreshold
	return amountToWithdraw
}

export function getWinningEscalationDepositClaimAmount({
	bindingCapital,
	depositAmount,
	cumulativeAmount,
	forkThreshold,
	nonDecisionThreshold,
	winningOutcomeBalance,
}: {
	bindingCapital: bigint
	depositAmount: bigint
	cumulativeAmount: bigint
	forkThreshold: bigint
	nonDecisionThreshold: bigint
	winningOutcomeBalance: bigint
}) {
	return getWinningWithdrawalAmount({
		bindingCapital,
		depositAmount,
		depositEnd: cumulativeAmount,
		depositStart: cumulativeAmount - depositAmount,
		forkThreshold,
		nonDecisionThreshold,
		winningOutcomeBalance,
	})
}

export function getWinningImportedEscalationDepositClaimAmount({
	bindingCapital,
	depositAmount,
	postDepositCumulativeAmount,
	forkThreshold,
	nonDecisionThreshold,
	winningOutcomeBalance,
}: {
	bindingCapital: bigint
	depositAmount: bigint
	postDepositCumulativeAmount: bigint
	forkThreshold: bigint
	nonDecisionThreshold: bigint
	winningOutcomeBalance: bigint
}) {
	return getWinningWithdrawalAmount({
		bindingCapital,
		depositAmount,
		depositEnd: postDepositCumulativeAmount,
		depositStart: postDepositCumulativeAmount - depositAmount,
		forkThreshold,
		nonDecisionThreshold,
		winningOutcomeBalance,
	})
}
