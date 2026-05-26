import type { ActiveReportingDetails, EscalationDeposit, EscalationSide, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { formatCurrencyBalance } from './formatters.js'
import { requireDefined } from './required.js'
import { getTimeRemaining } from './time.js'
type ReportingAmountSuggestion = {
	amount: bigint | undefined
	reason: string | undefined
}
const REP_UNIT = 10n ** 18n
const ESCALATION_TIME_LENGTH = 4233600n
export const ESCALATION_GAME_ACTIVATION_DELAY = 3n * 24n * 60n * 60n
const SCALE = 1000000n
const LN2_SCALED = 693147n
const MAX_ATANH_ITERATIONS = 16
const LOAD_REPORTING_PRESETS_REASON = 'Load reporting details before using presets.'
const MAX_PROFIT_NOT_STARTED_REASON = 'Max profit becomes available after the escalation game starts.'
const SELECTED_SIDE_ALREADY_LEADS_REASON = 'Selected side already leads.'
const ESCALATION_RESOLVED_REASON = 'Escalation is already resolved.'
type EscalationBalanceTuple = readonly [bigint, bigint, bigint]
type ProjectedEscalationDeposit = {
	acceptedAmount: bigint
	projectedBalances: EscalationBalanceTuple
	reachesNonDecision: boolean
}
type ProjectedEscalationEndTime = {
	acceptedAmount: bigint
	endsImmediately: boolean
	projectedEndTime: bigint
}
type ReportingTimerPreview =
	| {
			hypotheticalDuration: bigint
			kind: 'not-started'
			timeUntilEnd: bigint
			timeUntilStart: bigint
	  }
	| {
			acceptedAmount: bigint
			actualState: 'ends-immediately' | 'extends' | 'unchanged'
			hypotheticalDuration: bigint
			kind: 'active-or-pending'
			timerIncrease?: bigint
	  }
type EscalationPhase = 'Resolved' | 'Fork Triggered' | 'Pending Start' | 'Timed Out' | 'Active'
function roundUpToRepUnit(value: bigint) {
	if (value <= 0n) return 0n
	return ((value + REP_UNIT - 1n) / REP_UNIT) * REP_UNIT
}
function getSelectedAndOtherSides(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey) {
	const selectedSide = details.sides.find(side => side.key === selectedOutcome)
	const largestOtherBalance = details.sides.filter(side => side.key !== selectedOutcome).reduce((maxBalance, side) => (side.balance > maxBalance ? side.balance : maxBalance), 0n)
	return {
		largestOtherBalance,
		selectedSide,
	}
}
function getAvailableRoom(details: ActiveReportingDetails, selectedBalance: bigint) {
	return details.nonDecisionThreshold > selectedBalance ? details.nonDecisionThreshold - selectedBalance : 0n
}
function isUniqueWinner(selectedBalance: bigint, largestOtherBalance: bigint) {
	return selectedBalance > largestOtherBalance
}
export function getEscalationTimeRemaining(details: ActiveReportingDetails) {
	return requireDefined(getTimeRemaining(details.escalationEndTime, details.currentTime), 'Escalation end time is required')
}
function hasEscalationTimedOut(details: ActiveReportingDetails) {
	return details.currentTime >= details.escalationEndTime
}
export function isReportingClosed(details: ActiveReportingDetails) {
	return details.resolution !== 'none' || details.hasReachedNonDecision || hasEscalationTimedOut(details)
}
export function getEscalationPhase(details: ActiveReportingDetails): EscalationPhase {
	if (details.resolution !== 'none') return 'Resolved'
	if (details.hasReachedNonDecision) return 'Fork Triggered'
	if (details.currentTime < details.activationTime) return 'Pending Start'
	if (hasEscalationTimedOut(details)) return 'Timed Out'
	return 'Active'
}
export function getEscalationBalanceTuple(sides: EscalationSide[]): EscalationBalanceTuple {
	const invalidBalance = sides.find(side => side.key === 'invalid')?.balance ?? 0n
	const yesBalance = sides.find(side => side.key === 'yes')?.balance ?? 0n
	const noBalance = sides.find(side => side.key === 'no')?.balance ?? 0n
	return [invalidBalance, yesBalance, noBalance]
}
export function getEscalationBindingCapital(balances: EscalationBalanceTuple) {
	const [invalidBalance, yesBalance, noBalance] = balances
	if ((invalidBalance >= yesBalance && invalidBalance <= noBalance) || (invalidBalance >= noBalance && invalidBalance <= yesBalance)) return invalidBalance
	if ((yesBalance >= invalidBalance && yesBalance <= noBalance) || (yesBalance >= noBalance && yesBalance <= invalidBalance)) return yesBalance
	return noBalance
}
export function computeEscalationTimeSinceStartFromAttritionCost(startBond: bigint, nonDecisionThreshold: bigint, attritionCost: bigint) {
	if (attritionCost <= startBond) return 0n
	if (attritionCost >= nonDecisionThreshold) return ESCALATION_TIME_LENGTH
	const lnRatioScaled = computeLnRatioScaled(startBond, nonDecisionThreshold)
	if (lnRatioScaled === 0n) return 0n
	const lnCostRatioScaled = computeLnRatioScaled(startBond, attritionCost)
	return (lnCostRatioScaled * ESCALATION_TIME_LENGTH) / lnRatioScaled
}
function computeHypotheticalBindingDuration(startBond: bigint, nonDecisionThreshold: bigint, bindingCapital: bigint) {
	if (bindingCapital <= 0n) return 0n
	return computeEscalationTimeSinceStartFromAttritionCost(startBond, nonDecisionThreshold, bindingCapital)
}
export function projectEscalationEndTime(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ProjectedEscalationEndTime | undefined {
	if (amount <= 0n) return undefined
	const projectedDeposit = projectEscalationDeposit({
		amount,
		balances: getEscalationBalanceTuple(details.sides),
		nonDecisionThreshold: details.nonDecisionThreshold,
		outcome,
		startBond: details.startBond,
	})
	if (projectedDeposit === undefined) return undefined
	if (projectedDeposit.reachesNonDecision)
		return {
			acceptedAmount: projectedDeposit.acceptedAmount,
			endsImmediately: true,
			projectedEndTime: details.currentTime,
		}
	const projectedBindingCapital = getEscalationBindingCapital(projectedDeposit.projectedBalances)
	return {
		acceptedAmount: projectedDeposit.acceptedAmount,
		endsImmediately: false,
		projectedEndTime: details.activationTime + computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, projectedBindingCapital),
	}
}
function getWinningEscalationDepositClaimAmount(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, deposit: EscalationDeposit) {
	const winningOutcomeBalance = details.sides.find(side => side.key === outcome)?.balance
	if (winningOutcomeBalance === undefined) return undefined
	const bindingCapitalAmount = details.bindingCapital
	const rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / 2n
	const rewardEligiblePrincipalAmount = winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount
	const rewardBonusPoolAmount = (bindingCapitalAmount * 3n) / 5n
	let amountToWithdraw: bigint
	if (rewardEligiblePrincipalAmount === 0n) {
		amountToWithdraw = deposit.amount
	} else {
		const depositStart = deposit.cumulativeAmount - deposit.amount
		const eligibleEndAmount = deposit.cumulativeAmount < rewardEligibleCapAmount ? deposit.cumulativeAmount : rewardEligibleCapAmount
		const rewardEligibleDepositAmount = eligibleEndAmount > depositStart ? eligibleEndAmount - depositStart : 0n
		const cappedRewardEligibleDepositAmount = rewardEligibleDepositAmount > deposit.amount ? deposit.amount : rewardEligibleDepositAmount
		const bonusShare = (cappedRewardEligibleDepositAmount * rewardBonusPoolAmount) / rewardEligiblePrincipalAmount
		amountToWithdraw = deposit.amount + bonusShare
	}
	if (details.forkThreshold < details.nonDecisionThreshold) return (amountToWithdraw * details.forkThreshold) / details.nonDecisionThreshold
	return amountToWithdraw
}
export function getEscalationDepositClaimAmount(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey, deposit: EscalationDeposit) {
	if (details === undefined || details.status !== 'active' || !details.withdrawalEnabled) return undefined
	if (details.withdrawalState === 'canceled-by-external-fork') return deposit.amount
	const resolvedOutcome = details.questionOutcome !== 'none' ? details.questionOutcome : details.resolution
	if (resolvedOutcome === 'none') return undefined
	if (resolvedOutcome !== outcome) return 0n
	return getWinningEscalationDepositClaimAmount(details, outcome, deposit)
}
export function getReportingTimerPreview(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingTimerPreview | undefined {
	if (amount <= 0n) return undefined
	const hypotheticalDuration = computeHypotheticalBindingDuration(details.startBond, details.nonDecisionThreshold, amount)
	if (details.status === 'not-started') {
		const preview = previewReportingContribution(details, outcome, amount)
		if (preview.actualDepositAmount === undefined) return undefined
		return {
			hypotheticalDuration,
			kind: 'not-started',
			timeUntilEnd: ESCALATION_GAME_ACTIVATION_DELAY + hypotheticalDuration,
			timeUntilStart: ESCALATION_GAME_ACTIVATION_DELAY,
		}
	}
	if (isReportingClosed(details)) return undefined
	const projection = projectEscalationEndTime(details, outcome, amount)
	if (projection === undefined) return undefined
	if (projection.endsImmediately)
		return {
			acceptedAmount: projection.acceptedAmount,
			actualState: 'ends-immediately',
			hypotheticalDuration,
			kind: 'active-or-pending',
		}
	if (projection.projectedEndTime > details.escalationEndTime)
		return {
			acceptedAmount: projection.acceptedAmount,
			actualState: 'extends',
			hypotheticalDuration,
			kind: 'active-or-pending',
			timerIncrease: projection.projectedEndTime - details.escalationEndTime,
		}
	return {
		acceptedAmount: projection.acceptedAmount,
		actualState: 'unchanged',
		hypotheticalDuration,
		kind: 'active-or-pending',
	}
}
export function getLeadingEscalationOutcome(sides: EscalationSide[]) {
	let leadingSide: EscalationSide | undefined
	for (const side of sides) {
		if (leadingSide === undefined || side.balance > leadingSide.balance) leadingSide = side
	}
	return leadingSide?.key
}
export function getMinimumOutcomeChangeContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amount: undefined, reason: 'Selected side is unavailable.' }
	if (details.resolution === selectedOutcome || isUniqueWinner(selectedSide.balance, largestOtherBalance)) return { amount: 0n, reason: undefined }
	const requiredLeadAmount = largestOtherBalance + 1n - selectedSide.balance
	const enteredAmount = details.startBond > requiredLeadAmount ? details.startBond : requiredLeadAmount
	const amount = roundUpToRepUnit(enteredAmount)
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amount > availableRoom ? availableRoom : amount
	if (availableRoom === 0n || selectedSide.balance + effectiveAmount <= largestOtherBalance)
		return {
			amount: undefined,
			reason: 'Min preset unavailable because the selected side cannot take the lead within the remaining bond capacity.',
		}
	return { amount, reason: undefined }
}
export function getReportingMinimumOutcomeChangeContribution(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	if (details === undefined)
		return {
			amount: undefined,
			reason: LOAD_REPORTING_PRESETS_REASON,
		}
	if (details.status === 'not-started')
		return {
			amount: details.startBond,
			reason: undefined,
		}
	if (details.resolution !== 'none')
		return {
			amount: undefined,
			reason: ESCALATION_RESOLVED_REASON,
		}
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amount === 0n && minContribution.reason === undefined)
		return {
			amount: undefined,
			reason: SELECTED_SIDE_ALREADY_LEADS_REASON,
		}
	return minContribution
}
export function getMaxProfitContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amount === undefined)
		return {
			amount: undefined,
			reason: minContribution.reason ?? 'Max profit preset is unavailable.',
		}
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amount: undefined, reason: 'Selected side is unavailable.' }
	const rewardEligibleCap = largestOtherBalance + largestOtherBalance / 2n
	const targetFinalBalance = rewardEligibleCap < details.nonDecisionThreshold ? rewardEligibleCap : details.nonDecisionThreshold
	if (isUniqueWinner(selectedSide.balance, largestOtherBalance) && selectedSide.balance >= targetFinalBalance)
		return {
			amount: undefined,
			reason: 'Max profit preset unavailable because the reward window is already filled on the selected side.',
		}
	const requiredWindowAmount = targetFinalBalance > selectedSide.balance ? targetFinalBalance - selectedSide.balance : 0n
	const minimumEnteredAmount = minContribution.amount > requiredWindowAmount ? minContribution.amount : requiredWindowAmount
	const enteredAmount = details.startBond > minimumEnteredAmount ? details.startBond : minimumEnteredAmount
	const amount = roundUpToRepUnit(enteredAmount)
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amount > availableRoom ? availableRoom : amount
	if (selectedSide.balance + effectiveAmount < targetFinalBalance)
		return {
			amount: undefined,
			reason: 'Max profit preset unavailable because the selected side cannot fill the reward window within the remaining bond capacity.',
		}
	return { amount, reason: undefined }
}
export function getReportingMaxProfitContribution(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	if (details === undefined)
		return {
			amount: undefined,
			reason: LOAD_REPORTING_PRESETS_REASON,
		}
	if (details.status === 'not-started')
		return {
			amount: undefined,
			reason: MAX_PROFIT_NOT_STARTED_REASON,
		}
	if (details.resolution !== 'none')
		return {
			amount: undefined,
			reason: ESCALATION_RESOLVED_REASON,
		}
	return getMaxProfitContribution(details, selectedOutcome)
}
export function getSelectedOutcomeRewardWindowFillTimestamp(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey, acceptedAmount: bigint) {
	if (acceptedAmount <= 0n) return undefined
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return undefined
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = acceptedAmount > availableRoom ? availableRoom : acceptedAmount
	const projectedSelectedBalance = selectedSide.balance + effectiveAmount
	const rewardEligibleCap = largestOtherBalance + largestOtherBalance / 2n
	if (rewardEligibleCap <= 0n) return undefined
	const targetFinalBalance = rewardEligibleCap < details.nonDecisionThreshold ? rewardEligibleCap : details.nonDecisionThreshold
	if (projectedSelectedBalance >= targetFinalBalance) return undefined
	return details.activationTime + computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, targetFinalBalance)
}
export function calculateEstimatedEscalationReturn(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey, amount: bigint) {
	if (amount <= 0n)
		return {
			payout: 0n,
			profit: 0n,
		}
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined)
		return {
			payout: 0n,
			profit: 0n,
		}
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amount > availableRoom ? availableRoom : amount
	if (effectiveAmount <= 0n)
		return {
			payout: 0n,
			profit: 0n,
		}
	const projectedWinningStake = selectedSide.balance + effectiveAmount
	const bindingCapital = largestOtherBalance
	const rewardEligibleCap = bindingCapital + bindingCapital / 2n
	const rewardEligiblePrincipal = projectedWinningStake < rewardEligibleCap ? projectedWinningStake : rewardEligibleCap
	if (rewardEligiblePrincipal === 0n)
		return {
			payout: effectiveAmount,
			profit: 0n,
		}
	const depositStart = selectedSide.balance
	const depositEnd = selectedSide.balance + effectiveAmount
	const eligibleEnd = depositEnd < rewardEligibleCap ? depositEnd : rewardEligibleCap
	const rewardEligibleDepositAmount = eligibleEnd > depositStart ? eligibleEnd - depositStart : 0n
	const rewardBonusPool = (bindingCapital * 3n) / 5n
	const bonusShare = (rewardEligibleDepositAmount * rewardBonusPool) / rewardEligiblePrincipal
	return {
		payout: effectiveAmount + bonusShare,
		profit: bonusShare,
	}
}
type EscalationContributionPreview =
	| {
			actualDepositAmount: bigint
			reason: undefined
	  }
	| {
			actualDepositAmount: undefined
			reason: string
	  }
type ReportingContributionPreview = EscalationContributionPreview
function getEscalationSide(details: ActiveReportingDetails, outcome: ReportingOutcomeKey) {
	return details.sides.find(side => side.key === outcome)
}
function previewEscalationContribution(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): EscalationContributionPreview {
	if (details.resolution !== 'none')
		return {
			actualDepositAmount: undefined,
			reason: 'Escalation is already resolved.',
		}
	const selectedSide = getEscalationSide(details, outcome)
	if (selectedSide === undefined)
		return {
			actualDepositAmount: undefined,
			reason: 'Select a valid reporting outcome.',
		}
	if (selectedSide.balance >= details.nonDecisionThreshold)
		return {
			actualDepositAmount: undefined,
			reason: `Selected side is already full at ${formatCurrencyBalance(details.nonDecisionThreshold)} REP.`,
		}
	if (amount < details.startBond)
		return {
			actualDepositAmount: undefined,
			reason: `Enter at least ${formatCurrencyBalance(details.startBond)} REP to meet the current start bond.`,
		}
	const projectedDeposit = projectEscalationDeposit({
		amount,
		balances: getEscalationBalanceTuple(details.sides),
		nonDecisionThreshold: details.nonDecisionThreshold,
		outcome,
		startBond: details.startBond,
	})
	if (projectedDeposit === undefined)
		return {
			actualDepositAmount: undefined,
			reason: 'Increase the report amount slightly to avoid a tie at the minimum bond.',
		}
	return {
		actualDepositAmount: projectedDeposit.acceptedAmount,
		reason: undefined,
	}
}
export function previewReportingContribution(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingContributionPreview {
	if (details.status === 'not-started') {
		if (amount < details.startBond)
			return {
				actualDepositAmount: undefined,
				reason: `Enter at least ${formatCurrencyBalance(details.startBond)} REP to start the escalation game.`,
			}
		return {
			actualDepositAmount: amount,
			reason: undefined,
		}
	}
	return previewEscalationContribution(details, outcome, amount)
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
function getOutcomeIndex(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0
		case 'yes':
			return 1
		case 'no':
			return 2
		default:
			return assertNever(outcome)
	}
}
function getMaxEscalationBalance(balances: EscalationBalanceTuple) {
	const [invalidBalance, yesBalance, noBalance] = balances
	return (() => {
		if (invalidBalance > yesBalance) {
			if (invalidBalance > noBalance) return invalidBalance

			return noBalance
		}
		if (yesBalance > noBalance) return yesBalance

		return noBalance
	})()
}
function hasReachedNonDecision(balances: EscalationBalanceTuple, nonDecisionThreshold: bigint) {
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
function projectEscalationDeposit({ amount, balances, nonDecisionThreshold, outcome, startBond }: { amount: bigint; balances: EscalationBalanceTuple; nonDecisionThreshold: bigint; outcome: ReportingOutcomeKey; startBond: bigint }): ProjectedEscalationDeposit | undefined {
	if (amount < startBond) return undefined
	const outcomeIndex = getOutcomeIndex(outcome)
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
