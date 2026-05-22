import type { ActiveReportingDetails, EscalationSide, ReportingOutcomeKey } from '../types/contracts.js'
import { requireDefined } from './required.js'
import { getTimeRemaining } from './time.js'

type ReportingAmountSuggestion = {
	amount: bigint | undefined
	reason: string | undefined
}

const REP_UNIT = 10n ** 18n

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

export function getEscalationPhase(details: ActiveReportingDetails) {
	if (details.resolution !== 'none') return 'Resolved'
	if (details.currentTime < details.startingTime) return 'Pending Start'
	if (details.currentTime >= details.escalationEndTime) return 'Awaiting Resolution'
	return 'Active'
}

export function getLeadingEscalationOutcome(sides: EscalationSide[]) {
	let leadingSide: EscalationSide | undefined

	for (const side of sides) {
		if (leadingSide === undefined || side.balance > leadingSide.balance) {
			leadingSide = side
		}
	}

	return leadingSide?.key
}

export function getMinimumOutcomeChangeContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amount: undefined, reason: 'Selected side is unavailable.' }
	if (details.resolution === selectedOutcome || isUniqueWinner(selectedSide.balance, largestOtherBalance)) {
		return { amount: 0n, reason: undefined }
	}

	const requiredLeadAmount = largestOtherBalance + 1n - selectedSide.balance
	const enteredAmount = details.startBond > requiredLeadAmount ? details.startBond : requiredLeadAmount
	const amount = roundUpToRepUnit(enteredAmount)
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amount > availableRoom ? availableRoom : amount

	if (availableRoom === 0n || selectedSide.balance + effectiveAmount <= largestOtherBalance) {
		return {
			amount: undefined,
			reason: 'Min preset unavailable because the selected side cannot take the lead within the remaining bond capacity.',
		}
	}

	return { amount, reason: undefined }
}

export function getMaxProfitContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amount === undefined) {
		return {
			amount: undefined,
			reason: minContribution.reason ?? 'Max profit preset is unavailable.',
		}
	}

	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amount: undefined, reason: 'Selected side is unavailable.' }

	const rewardEligibleCap = largestOtherBalance + largestOtherBalance / 2n
	const targetFinalBalance = rewardEligibleCap < details.nonDecisionThreshold ? rewardEligibleCap : details.nonDecisionThreshold
	if (isUniqueWinner(selectedSide.balance, largestOtherBalance) && selectedSide.balance >= targetFinalBalance) {
		return {
			amount: undefined,
			reason: 'Max profit preset unavailable because the reward window is already filled on the selected side.',
		}
	}

	const requiredWindowAmount = targetFinalBalance > selectedSide.balance ? targetFinalBalance - selectedSide.balance : 0n
	const minimumEnteredAmount = minContribution.amount > requiredWindowAmount ? minContribution.amount : requiredWindowAmount
	const enteredAmount = details.startBond > minimumEnteredAmount ? details.startBond : minimumEnteredAmount
	const amount = roundUpToRepUnit(enteredAmount)
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amount > availableRoom ? availableRoom : amount

	if (selectedSide.balance + effectiveAmount < targetFinalBalance) {
		return {
			amount: undefined,
			reason: 'Max profit preset unavailable because the selected side cannot fill the reward window within the remaining bond capacity.',
		}
	}

	return { amount, reason: undefined }
}

export function calculateEstimatedEscalationReturn(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey, amount: bigint) {
	if (amount <= 0n) {
		return {
			payout: 0n,
			profit: 0n,
		}
	}

	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) {
		return {
			payout: 0n,
			profit: 0n,
		}
	}

	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amount > availableRoom ? availableRoom : amount
	if (effectiveAmount <= 0n) {
		return {
			payout: 0n,
			profit: 0n,
		}
	}

	const projectedWinningStake = selectedSide.balance + effectiveAmount
	const bindingCapital = largestOtherBalance
	const rewardEligibleCap = bindingCapital + bindingCapital / 2n
	const rewardEligiblePrincipal = projectedWinningStake < rewardEligibleCap ? projectedWinningStake : rewardEligibleCap
	if (rewardEligiblePrincipal === 0n) {
		return {
			payout: effectiveAmount,
			profit: 0n,
		}
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
