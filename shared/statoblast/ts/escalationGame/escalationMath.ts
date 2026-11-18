export type EscalationOutcomeKey = 'invalid' | 'yes' | 'no'
export type EscalationBalanceTuple = readonly [invalidBalanceAttoRep: bigint, yesBalanceAttoRep: bigint, noBalanceAttoRep: bigint]
export type ProjectedEscalationDeposit = {
	acceptedAmountAttoRep: bigint
	projectedBalancesAttoRep: EscalationBalanceTuple
	reachesNonDecision: boolean
	/** The outcome was below the previous maximum and now exceeds it, which restarts the response period. */
	takesLead: boolean
	tieAdjusted: boolean
}

export const ESCALATION_TIME_LENGTH = 4233600n
/** Activation delay, and the response period a change of leader restarts. */
export const ESCALATION_ACTIVATION_DELAY = 259200n

const SCALE = 1000000n
const LN2_SCALED = 693147n
const MAX_ATANH_ITERATIONS = 16
const MAX_EXP_ITERATIONS = 16

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

function computeIterativeAttritionCostAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, lnRatioScaled: bigint, timeSinceStart: bigint) {
	if (timeSinceStart <= 0n) return startBondAttoRep
	if (timeSinceStart >= ESCALATION_TIME_LENGTH) return nonDecisionThresholdAttoRep
	const exponent = (lnRatioScaled * timeSinceStart) / ESCALATION_TIME_LENGTH
	const exponentPow2 = exponent / LN2_SCALED
	const exponentRemainder = exponent - exponentPow2 * LN2_SCALED
	let expScaled = SCALE + exponentRemainder
	let term = exponentRemainder
	for (let iteration = 2; iteration < MAX_EXP_ITERATIONS; iteration += 1) {
		term = (term * exponentRemainder) / (BigInt(iteration) * SCALE)
		if (term === 0n) break
		expScaled += term
	}
	expScaled <<= exponentPow2
	const cost = (startBondAttoRep * expScaled) / SCALE
	return cost > nonDecisionThresholdAttoRep ? nonDecisionThresholdAttoRep : cost
}

export function computeEscalationBindingCapitalAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, timeSinceStart: bigint) {
	if (startBondAttoRep <= 0n || nonDecisionThresholdAttoRep <= startBondAttoRep) throw new Error('Escalation threshold must exceed the start bond')
	return computeIterativeAttritionCostAttoRep(startBondAttoRep, nonDecisionThresholdAttoRep, computeLnRatioScaled(startBondAttoRep, nonDecisionThresholdAttoRep), timeSinceStart)
}

/** The contract's `totalCostAttoRep`: zero until the curve starts, then the forward curve. */
export function computeEscalationCurveAttoRep(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, timeSinceStart: bigint) {
	if (timeSinceStart <= 0n) return 0n
	return computeEscalationBindingCapitalAttoRep(startBondAttoRep, nonDecisionThresholdAttoRep, timeSinceStart)
}

/** Last second before the forward curve strictly exceeds binding capital. */
export function computeEscalationFinalityElapsed(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, bindingCapitalAttoRep: bigint) {
	if (startBondAttoRep <= 0n || nonDecisionThresholdAttoRep <= startBondAttoRep) throw new Error('Escalation threshold must exceed the start bond')
	if (bindingCapitalAttoRep < startBondAttoRep) return 0n
	if (bindingCapitalAttoRep >= nonDecisionThresholdAttoRep) return ESCALATION_TIME_LENGTH
	const lnRatioScaled = computeLnRatioScaled(startBondAttoRep, nonDecisionThresholdAttoRep)
	let lower = 0n
	let upper = ESCALATION_TIME_LENGTH
	while (upper - lower > 1n) {
		const middle = lower + (upper - lower) / 2n
		if (computeIterativeAttritionCostAttoRep(startBondAttoRep, nonDecisionThresholdAttoRep, lnRatioScaled, middle) <= bindingCapitalAttoRep) lower = middle
		else upper = middle
	}
	return lower
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

/**
 * Support an accepted deposit's outcome must reach: the curve once it has passed
 * the median and one outcome strictly leads, otherwise zero. Mirrors the
 * contract's provisional resolution, which stays open while two outcomes meet
 * the curve or while the two largest outcomes tie.
 */
export function getEscalationRequiredSupportAttoRep(balancesAttoRep: EscalationBalanceTuple, curveAttoRep: bigint) {
	if (balancesAttoRep.filter(balanceAttoRep => balanceAttoRep >= curveAttoRep).length >= 2) return 0n
	const maxBalanceAttoRep = getMaxEscalationBalanceAttoRep(balancesAttoRep)
	if (maxBalanceAttoRep > 0n && balancesAttoRep.filter(balanceAttoRep => balanceAttoRep === maxBalanceAttoRep).length >= 2) return 0n
	return curveAttoRep
}

/**
 * Projects the deposit the game accepts, or undefined when it rejects the amount.
 * Pass the curve at the deposit's timestamp to apply the rule that support added
 * after the curve passes the median must meet the curve.
 */
export function projectEscalationDeposit({
	amountAttoRep,
	balancesAttoRep,
	curveAttoRep = 0n,
	nonDecisionThresholdAttoRep,
	outcome,
	startBondAttoRep,
}: {
	amountAttoRep: bigint
	balancesAttoRep: EscalationBalanceTuple
	curveAttoRep?: bigint
	nonDecisionThresholdAttoRep: bigint
	outcome: EscalationOutcomeKey
	startBondAttoRep: bigint
}): ProjectedEscalationDeposit | undefined {
	const outcomeIndex = getEscalationOutcomeIndex(outcome)
	const currentBalanceAttoRep = balancesAttoRep[outcomeIndex]
	if (currentBalanceAttoRep >= nonDecisionThresholdAttoRep) return undefined
	const roomAttoRep = nonDecisionThresholdAttoRep - currentBalanceAttoRep
	let acceptedAmountAttoRep = amountAttoRep > roomAttoRep ? roomAttoRep : amountAttoRep
	let newBalanceAttoRep = currentBalanceAttoRep + acceptedAmountAttoRep
	// The start bond applies to the amount offered, before the tie trim.
	if (acceptedAmountAttoRep < startBondAttoRep && newBalanceAttoRep !== nonDecisionThresholdAttoRep) return undefined
	let tieAdjusted = false
	const maxBalanceAttoRep = getMaxEscalationBalanceAttoRep(balancesAttoRep)
	const otherHasMax = (() => {
		if (outcomeIndex === 0) return balancesAttoRep[1] === maxBalanceAttoRep || balancesAttoRep[2] === maxBalanceAttoRep
		if (outcomeIndex === 1) return balancesAttoRep[0] === maxBalanceAttoRep || balancesAttoRep[2] === maxBalanceAttoRep
		return balancesAttoRep[0] === maxBalanceAttoRep || balancesAttoRep[1] === maxBalanceAttoRep
	})()
	if (newBalanceAttoRep === maxBalanceAttoRep && otherHasMax && maxBalanceAttoRep < nonDecisionThresholdAttoRep) {
		tieAdjusted = true
		acceptedAmountAttoRep -= 1n
		newBalanceAttoRep = currentBalanceAttoRep + acceptedAmountAttoRep
	}
	if (newBalanceAttoRep < getEscalationRequiredSupportAttoRep(balancesAttoRep, curveAttoRep)) return undefined
	const projectedBalancesAttoRep = setBalanceAtIndex(balancesAttoRep, outcomeIndex, newBalanceAttoRep)
	return {
		acceptedAmountAttoRep,
		projectedBalancesAttoRep,
		reachesNonDecision: hasReachedNonDecision(projectedBalancesAttoRep, nonDecisionThresholdAttoRep),
		takesLead: currentBalanceAttoRep < maxBalanceAttoRep && newBalanceAttoRep > maxBalanceAttoRep,
		tieAdjusted,
	}
}

/**
 * The contract's `getEscalationGameEndDate` for an unresolved game without a
 * fixed outcome, after a deposit accepted at `timestamp`. A continuation must
 * already be resumed.
 */
export function projectEscalationEndTime({
	activationTime,
	continuation,
	nonDecisionThresholdAttoRep,
	projection,
	responseRestartedUntil,
	startBondAttoRep,
	timestamp,
}: {
	activationTime: bigint
	continuation?: { forkElapsedAtStart: bigint; forkResumedAt: bigint } | undefined
	nonDecisionThresholdAttoRep: bigint
	projection: Pick<ProjectedEscalationDeposit, 'projectedBalancesAttoRep' | 'takesLead'>
	responseRestartedUntil: bigint
	startBondAttoRep: bigint
	timestamp: bigint
}) {
	const [, medianBalanceAttoRep] = [...projection.projectedBalancesAttoRep].sort((left, right) => {
		if (left < right) return -1
		return left > right ? 1 : 0
	})
	const finalityElapsed = computeEscalationFinalityElapsed(startBondAttoRep, nonDecisionThresholdAttoRep, medianBalanceAttoRep ?? 0n)
	let curveEnd = activationTime + finalityElapsed
	let responseEnd = projection.takesLead ? timestamp + ESCALATION_ACTIVATION_DELAY : responseRestartedUntil
	if (continuation !== undefined) {
		curveEnd = finalityElapsed <= continuation.forkElapsedAtStart ? continuation.forkResumedAt : continuation.forkResumedAt + finalityElapsed - continuation.forkElapsedAtStart
		const resumedResponseEnd = continuation.forkResumedAt + ESCALATION_ACTIVATION_DELAY
		if (resumedResponseEnd > responseEnd) responseEnd = resumedResponseEnd
	}
	return curveEnd > responseEnd ? curveEnd : responseEnd
}

function getWinningWithdrawalAmount({
	bindingCapitalAttoRep,
	depositAmountAttoRep,
	principalAttoRep = depositAmountAttoRep,
	depositEndAttoRep,
	depositStartAttoRep,
	forkThresholdAttoRep,
	nonDecisionThresholdAttoRep,
	winningOutcomeBalanceAttoRep,
}: {
	bindingCapitalAttoRep: bigint
	depositAmountAttoRep: bigint
	principalAttoRep?: bigint
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
		amountToWithdrawAttoRep = principalAttoRep
	} else {
		const eligibleEndAttoRep = depositEndAttoRep < rewardEligibleCapAttoRep ? depositEndAttoRep : rewardEligibleCapAttoRep
		const rewardEligibleDepositAttoRep = eligibleEndAttoRep > depositStartAttoRep ? eligibleEndAttoRep - depositStartAttoRep : 0n
		const cappedRewardEligibleDepositAttoRep = rewardEligibleDepositAttoRep > depositAmountAttoRep ? depositAmountAttoRep : rewardEligibleDepositAttoRep
		const rewardBonusPoolAttoRep = (bindingCapitalAttoRep * 3n) / 5n
		const bonusAttoRep = (cappedRewardEligibleDepositAttoRep * rewardBonusPoolAttoRep) / rewardEligiblePrincipalAttoRep
		amountToWithdrawAttoRep = principalAttoRep + bonusAttoRep
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
	ordinarySettlement = false,
}: {
	bindingCapitalAttoRep: bigint
	depositAmountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	forkThresholdAttoRep: bigint
	nonDecisionThresholdAttoRep: bigint
	winningOutcomeBalanceAttoRep: bigint
	ordinarySettlement?: boolean
}) {
	if (ordinarySettlement) {
		const cumulativePayout = (end: bigint) => getWinningWithdrawalAmount({ bindingCapitalAttoRep, depositAmountAttoRep: end, depositEndAttoRep: end, depositStartAttoRep: 0n, forkThresholdAttoRep, nonDecisionThresholdAttoRep, winningOutcomeBalanceAttoRep })
		return cumulativePayout(cumulativeAmountAttoRep) - cumulativePayout(cumulativeAmountAttoRep - depositAmountAttoRep)
	}
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
	principalAttoRep,
	postDepositCumulativeAmountAttoRep,
	forkThresholdAttoRep,
	nonDecisionThresholdAttoRep,
	winningOutcomeBalanceAttoRep,
}: {
	bindingCapitalAttoRep: bigint
	depositAmountAttoRep: bigint
	principalAttoRep?: bigint
	postDepositCumulativeAmountAttoRep: bigint
	forkThresholdAttoRep: bigint
	nonDecisionThresholdAttoRep: bigint
	winningOutcomeBalanceAttoRep: bigint
}) {
	return getWinningWithdrawalAmount({
		bindingCapitalAttoRep,
		depositAmountAttoRep,
		principalAttoRep: principalAttoRep ?? depositAmountAttoRep,
		depositEndAttoRep: postDepositCumulativeAmountAttoRep,
		depositStartAttoRep: postDepositCumulativeAmountAttoRep - depositAmountAttoRep,
		forkThresholdAttoRep,
		nonDecisionThresholdAttoRep,
		winningOutcomeBalanceAttoRep,
	})
}
