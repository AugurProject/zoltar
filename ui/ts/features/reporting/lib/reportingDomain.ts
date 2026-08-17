import {
	computeEscalationTimeSinceStartFromAttritionCostAttoRep,
	getEscalationBindingCapitalAttoRep,
	getWinningEscalationDepositClaimAmount as computeWinningEscalationDepositClaimAmount,
	getWinningImportedEscalationDepositClaimAmount as computeWinningImportedEscalationDepositClaimAmount,
	projectEscalationDeposit,
	type EscalationBalanceTuple,
} from '@zoltar/shared/escalationMath'
import type { ActiveReportingDetails, EscalationDeposit, EscalationSide, ImportedEscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '../../../types/contracts.js'
import { formatCurrencyBalanceWithUnit } from '../../../lib/formatters.js'
import { requireDefined } from '../../../lib/required.js'
import { getTimeRemaining } from '../../../lib/time.js'
type ReportingAmountSuggestion = {
	amountAttoRep: bigint | undefined
	reason: string | undefined
}
const REP_UNIT = 10n ** 18n
export const ESCALATION_GAME_ACTIVATION_DELAY = 3n * 24n * 60n * 60n
export { computeEscalationTimeSinceStartFromAttritionCostAttoRep, getEscalationBindingCapitalAttoRep }
const LOAD_REPORTING_PRESETS_REASON = 'Loading reporting details.'
const MAX_PROFIT_NOT_STARTED_REASON = 'Max profit becomes available after the escalation game starts.'
const SELECTED_SIDE_ALREADY_LEADS_REASON = 'Selected side already leads.'
const ESCALATION_RESOLVED_REASON = 'Escalation is already resolved.'
type ProjectedEscalationEndTime = {
	acceptedAmountAttoRep: bigint
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
			acceptedAmountAttoRep: bigint
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
	return details.nonDecisionThresholdAttoRep > selectedBalance ? details.nonDecisionThresholdAttoRep - selectedBalance : 0n
}
function isUniqueWinner(selectedBalance: bigint, largestOtherBalance: bigint) {
	return selectedBalance > largestOtherBalance
}
export function getEscalationTimeRemaining(details: ActiveReportingDetails) {
	if (details.hasReachedNonDecision) return 0n
	return requireDefined(getTimeRemaining(details.escalationEndTime, details.currentTime), 'Escalation end time is required')
}
function hasEscalationTimedOut(details: ActiveReportingDetails) {
	return details.currentTime > details.escalationEndTime
}
export function isPoolQuestionFinalized(details: Pick<ReportingDetails, 'questionOutcome' | 'systemState'> | undefined) {
	return details !== undefined && details.systemState === 'operational' && details.questionOutcome !== 'none'
}
export function isReportingClosed(details: ActiveReportingDetails) {
	return isPoolQuestionFinalized(details) || details.hasReachedNonDecision || hasEscalationTimedOut(details)
}
export function getEscalationPhase(details: ActiveReportingDetails): EscalationPhase {
	if (isPoolQuestionFinalized(details)) return 'Resolved'
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
function computeHypotheticalBindingDuration(startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint, bindingCapitalAttoRep: bigint) {
	if (bindingCapitalAttoRep <= 0n) return 0n
	return computeEscalationTimeSinceStartFromAttritionCostAttoRep(startBondAttoRep, nonDecisionThresholdAttoRep, bindingCapitalAttoRep)
}
export function projectEscalationEndTime(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ProjectedEscalationEndTime | undefined {
	if (amount <= 0n) return undefined
	const projectedDeposit = projectEscalationDeposit({
		amountAttoRep: amount,
		balancesAttoRep: getEscalationBalanceTuple(details.sides),
		nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep,
		outcome,
		startBondAttoRep: details.startBondAttoRep,
	})
	if (projectedDeposit === undefined) return undefined
	if (projectedDeposit.reachesNonDecision)
		return {
			acceptedAmountAttoRep: projectedDeposit.acceptedAmountAttoRep,
			endsImmediately: true,
			projectedEndTime: details.currentTime,
		}
	const projectedBindingCapital = getEscalationBindingCapitalAttoRep(projectedDeposit.projectedBalancesAttoRep)
	return {
		acceptedAmountAttoRep: projectedDeposit.acceptedAmountAttoRep,
		endsImmediately: false,
		projectedEndTime: details.activationTime + computeEscalationTimeSinceStartFromAttritionCostAttoRep(details.startBondAttoRep, details.nonDecisionThresholdAttoRep, projectedBindingCapital),
	}
}
function getWinningEscalationDepositClaimAmount(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, deposit: EscalationDeposit) {
	const winningOutcomeBalance = details.sides.find(side => side.key === outcome)?.balance
	if (winningOutcomeBalance === undefined) return undefined
	return computeWinningEscalationDepositClaimAmount({
		bindingCapitalAttoRep: details.bindingCapital,
		cumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
		depositAmountAttoRep: deposit.amountAttoRep,
		forkThresholdAttoRep: details.forkThresholdAttoRep,
		nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep,
		winningOutcomeBalanceAttoRep: winningOutcomeBalance,
	})
}
function getWinningImportedEscalationDepositClaimAmount(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, deposit: ImportedEscalationDeposit) {
	const winningOutcomeBalance = details.sides.find(side => side.key === outcome)?.balance
	if (winningOutcomeBalance === undefined) return undefined
	return computeWinningImportedEscalationDepositClaimAmount({
		bindingCapitalAttoRep: details.bindingCapital,
		postDepositCumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
		depositAmountAttoRep: deposit.amountAttoRep,
		forkThresholdAttoRep: details.forkThresholdAttoRep,
		nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep,
		winningOutcomeBalanceAttoRep: winningOutcomeBalance,
	})
}
export function getEscalationDepositClaimAmount(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey, deposit: EscalationDeposit) {
	if (details === undefined || details.status !== 'active' || !details.parentWithdrawalEnabled) return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	if (details.questionOutcome !== outcome) return 0n
	return getWinningEscalationDepositClaimAmount(details, outcome, deposit)
}
export function getImportedEscalationDepositClaimAmount(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey, deposit: ImportedEscalationDeposit) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	if (details.questionOutcome !== outcome) return 0n
	return getWinningImportedEscalationDepositClaimAmount(details, outcome, deposit)
}

export function getRemainingSelectedOutcomeContributionCapacity(details: ReportingDetails, outcome: ReportingOutcomeKey) {
	if (details.status === 'not-started') return details.nonDecisionThresholdAttoRep
	const selectedSide = details.sides.find(side => side.key === outcome)
	if (selectedSide === undefined) return 0n
	return details.nonDecisionThresholdAttoRep > selectedSide.balance ? details.nonDecisionThresholdAttoRep - selectedSide.balance : 0n
}

export function getReportingTimerPreview(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingTimerPreview | undefined {
	if (amount <= 0n) return undefined
	const hypotheticalDuration = computeHypotheticalBindingDuration(details.startBondAttoRep, details.nonDecisionThresholdAttoRep, amount)
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
			acceptedAmountAttoRep: projection.acceptedAmountAttoRep,
			actualState: 'ends-immediately',
			hypotheticalDuration,
			kind: 'active-or-pending',
		}
	if (projection.projectedEndTime > details.escalationEndTime)
		return {
			acceptedAmountAttoRep: projection.acceptedAmountAttoRep,
			actualState: 'extends',
			hypotheticalDuration,
			kind: 'active-or-pending',
			timerIncrease: projection.projectedEndTime - details.escalationEndTime,
		}
	return {
		acceptedAmountAttoRep: projection.acceptedAmountAttoRep,
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
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: 'Selected side is unavailable.' }
	if ((isPoolQuestionFinalized(details) && details.questionOutcome === selectedOutcome) || isUniqueWinner(selectedSide.balance, largestOtherBalance)) return { amountAttoRep: 0n, reason: undefined }
	const requiredLeadAmount = largestOtherBalance + 1n - selectedSide.balance
	const enteredAmount = details.startBondAttoRep > requiredLeadAmount ? details.startBondAttoRep : requiredLeadAmount
	const amountAttoRep = roundUpToRepUnit(enteredAmount)
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amountAttoRep > availableRoom ? availableRoom : amountAttoRep
	if (availableRoom === 0n)
		return {
			amountAttoRep: undefined,
			reason: 'No remaining contribution capacity is available on the selected side.',
		}
	if (selectedSide.balance + effectiveAmount <= largestOtherBalance) {
		const cappedEnteredAmount = details.startBondAttoRep > availableRoom ? details.startBondAttoRep : availableRoom
		return {
			amountAttoRep: roundUpToRepUnit(cappedEnteredAmount),
			reason: undefined,
		}
	}
	return { amountAttoRep, reason: undefined }
}
export function getReportingMinimumOutcomeChangeContribution(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	if (details === undefined)
		return {
			amountAttoRep: undefined,
			reason: LOAD_REPORTING_PRESETS_REASON,
		}
	if (details.status === 'not-started')
		return {
			amountAttoRep: details.startBondAttoRep,
			reason: undefined,
		}
	if (isPoolQuestionFinalized(details))
		return {
			amountAttoRep: undefined,
			reason: ESCALATION_RESOLVED_REASON,
		}
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amountAttoRep === 0n && minContribution.reason === undefined)
		return {
			amountAttoRep: undefined,
			reason: SELECTED_SIDE_ALREADY_LEADS_REASON,
		}
	return minContribution
}
export function getMaxProfitContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amountAttoRep === undefined)
		return {
			amountAttoRep: undefined,
			reason: minContribution.reason ?? 'Max profit preset is unavailable.',
		}
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: 'Selected side is unavailable.' }
	const rewardEligibleCap = largestOtherBalance + largestOtherBalance / 2n
	const targetFinalBalance = rewardEligibleCap < details.nonDecisionThresholdAttoRep ? rewardEligibleCap : details.nonDecisionThresholdAttoRep
	if (isUniqueWinner(selectedSide.balance, largestOtherBalance) && selectedSide.balance >= targetFinalBalance)
		return {
			amountAttoRep: undefined,
			reason: 'Max profit preset unavailable because the reward window is already filled on the selected side.',
		}
	const requiredWindowAmount = targetFinalBalance > selectedSide.balance ? targetFinalBalance - selectedSide.balance : 0n
	const minimumEnteredAmount = minContribution.amountAttoRep > requiredWindowAmount ? minContribution.amountAttoRep : requiredWindowAmount
	const enteredAmount = details.startBondAttoRep > minimumEnteredAmount ? details.startBondAttoRep : minimumEnteredAmount
	const amountAttoRep = roundUpToRepUnit(enteredAmount)
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amountAttoRep > availableRoom ? availableRoom : amountAttoRep
	if (selectedSide.balance + effectiveAmount < targetFinalBalance)
		return {
			amountAttoRep: undefined,
			reason: 'Max profit preset unavailable because the selected side cannot fill the reward window within the remaining bond capacity.',
		}
	return { amountAttoRep, reason: undefined }
}
export function getReportingMaxProfitContribution(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	if (details === undefined)
		return {
			amountAttoRep: undefined,
			reason: LOAD_REPORTING_PRESETS_REASON,
		}
	if (details.status === 'not-started')
		return {
			amountAttoRep: undefined,
			reason: MAX_PROFIT_NOT_STARTED_REASON,
		}
	if (isPoolQuestionFinalized(details))
		return {
			amountAttoRep: undefined,
			reason: ESCALATION_RESOLVED_REASON,
		}
	return getMaxProfitContribution(details, selectedOutcome)
}
export function getSelectedOutcomeRewardWindowFillTimestamp(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey, acceptedAmountAttoRep: bigint) {
	if (acceptedAmountAttoRep <= 0n) return undefined
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return undefined
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = acceptedAmountAttoRep > availableRoom ? availableRoom : acceptedAmountAttoRep
	const projectedSelectedBalance = selectedSide.balance + effectiveAmount
	const rewardEligibleCap = largestOtherBalance + largestOtherBalance / 2n
	if (rewardEligibleCap <= 0n) return undefined
	const targetFinalBalance = rewardEligibleCap < details.nonDecisionThresholdAttoRep ? rewardEligibleCap : details.nonDecisionThresholdAttoRep
	if (projectedSelectedBalance >= targetFinalBalance) return undefined
	return details.activationTime + computeEscalationTimeSinceStartFromAttritionCostAttoRep(details.startBondAttoRep, details.nonDecisionThresholdAttoRep, targetFinalBalance)
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
	const bonusAttoRep = (rewardEligibleDepositAmount * rewardBonusPool) / rewardEligiblePrincipal
	return {
		payout: effectiveAmount + bonusAttoRep,
		profit: bonusAttoRep,
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
	if (isPoolQuestionFinalized(details))
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
	if (selectedSide.balance >= details.nonDecisionThresholdAttoRep)
		return {
			actualDepositAmount: undefined,
			reason: `Selected side is already full at ${formatCurrencyBalanceWithUnit(details.nonDecisionThresholdAttoRep, 'REP')}.`,
		}
	if (amount < details.startBondAttoRep)
		return {
			actualDepositAmount: undefined,
			reason: `Enter at least ${formatCurrencyBalanceWithUnit(details.startBondAttoRep, 'REP')} to meet the current start bond.`,
		}
	const projectedDeposit = projectEscalationDeposit({
		amountAttoRep: amount,
		balancesAttoRep: getEscalationBalanceTuple(details.sides),
		nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep,
		outcome,
		startBondAttoRep: details.startBondAttoRep,
	})
	if (projectedDeposit === undefined)
		return {
			actualDepositAmount: undefined,
			reason: 'Increase the report amount slightly to avoid a tie at the minimum bond.',
		}
	return {
		actualDepositAmount: projectedDeposit.acceptedAmountAttoRep,
		reason: undefined,
	}
}
export function previewReportingContribution(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingContributionPreview {
	if (details.status === 'not-started') {
		if (amount < details.startBondAttoRep)
			return {
				actualDepositAmount: undefined,
				reason: `Enter at least ${formatCurrencyBalanceWithUnit(details.startBondAttoRep, 'REP')} to start the escalation game.`,
			}
		return {
			actualDepositAmount: amount,
			reason: undefined,
		}
	}
	return previewEscalationContribution(details, outcome, amount)
}
