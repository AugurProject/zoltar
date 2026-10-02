import * as reportingCopy from '../../../copy/reporting.js'
import {
	getWinningEscalationDepositClaimAmount as computeWinningEscalationDepositClaimAmount,
	getWinningImportedEscalationDepositClaimAmount as computeWinningImportedEscalationDepositClaimAmount,
	computeEscalationTimeSinceStartFromAttritionCostAttoRep,
	projectEscalationDeposit,
	type EscalationBalanceTuple,
} from '@zoltar/statoblast-shared/escalationGame/escalationMath'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActiveReportingDetails, EscalationDeposit, EscalationSide, ImportedEscalationDeposit, ReportingDetails } from '../../../types/contracts.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
type ReportingAmountSuggestion = {
	amountAttoRep: bigint | undefined
	reason: string | undefined
}
export const ESCALATION_GAME_ACTIVATION_DELAY = 3n * 24n * 60n * 60n
const LOAD_REPORTING_PRESETS_REASON = 'Loading reporting details.'
const MAX_PROFIT_NOT_STARTED_REASON = reportingCopy.maxProfitPrestartReason
const SELECTED_SIDE_ALREADY_LEADS_REASON = reportingCopy.selectedSideLeadsReason
const ESCALATION_RESOLVED_REASON = 'Escalation is already resolved.'
type EscalationPhase = 'Resolved' | 'Fork Triggered' | 'Pending Start' | 'Timed Out' | 'Active'
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
function hasEscalationTimedOut(details: ActiveReportingDetails) {
	return details.currentTime > details.escalationEndTime
}
export function isPoolQuestionFinalized(details: Pick<ReportingDetails, 'questionOutcome' | 'systemState'> | undefined) {
	return details !== undefined && details.systemState === 'operational' && details.questionOutcome !== 'none'
}
export function getEscalationPhase(details: ActiveReportingDetails): EscalationPhase {
	if (isPoolQuestionFinalized(details)) return 'Resolved'
	if (details.hasReachedNonDecision) return 'Fork Triggered'
	// The contract attrition clock only advances once block.timestamp is strictly past activationTime.
	if (details.currentTime <= details.activationTime) return 'Pending Start'
	if (hasEscalationTimedOut(details)) return 'Timed Out'
	return 'Active'
}
function getEscalationBalanceTuple(sides: EscalationSide[]): EscalationBalanceTuple {
	const invalidBalance = sides.find(side => side.key === 'invalid')?.balance ?? 0n
	const yesBalance = sides.find(side => side.key === 'yes')?.balance ?? 0n
	const noBalance = sides.find(side => side.key === 'no')?.balance ?? 0n
	return [invalidBalance, yesBalance, noBalance]
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
export function getStrictLeadingEscalationOutcome(sides: EscalationSide[]) {
	if (sides.length === 0) return undefined
	const maximum = sides.reduce((largest, side) => (side.balance > largest ? side.balance : largest), 0n)
	if (maximum === 0n) return 'invalid'
	const leaders = sides.filter(side => side.balance === maximum)
	return leaders.length === 1 ? leaders[0]?.key : undefined
}
export function getHypotheticalClaimAmount(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, deposit: EscalationDeposit | ImportedEscalationDeposit) {
	const leader = getStrictLeadingEscalationOutcome(details.sides)
	if (leader === undefined) return undefined
	if (outcome !== leader) return 0n
	const hypotheticalDetails: ActiveReportingDetails = { ...details, questionOutcome: leader, systemState: 'operational', parentWithdrawalEnabled: true }
	// Imported cumulative amounts use a different allocation convention.
	return 'parentDepositIndex' in deposit ? getImportedEscalationDepositClaimAmount(hypotheticalDetails, outcome, deposit) : getEscalationDepositClaimAmount(hypotheticalDetails, outcome, deposit)
}
function getMinimumOutcomeChangeContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: 'Selected side is unavailable.' }
	if ((isPoolQuestionFinalized(details) && details.questionOutcome === selectedOutcome) || isUniqueWinner(selectedSide.balance, largestOtherBalance)) return { amountAttoRep: 0n, reason: undefined }
	const requiredLeadAmount = largestOtherBalance + 1n - selectedSide.balance
	const amountAttoRep = details.startBondAttoRep > requiredLeadAmount ? details.startBondAttoRep : requiredLeadAmount
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
			amountAttoRep: cappedEnteredAmount,
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
/** Entered amount from which a report on `outcome` fills its side to the non-decision threshold while another side already sits there, which ends the game and lets anyone trigger the universe fork. */
export function getReportingForkTriggerAmount(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey) {
	if (details?.status !== 'active' || details.hasReachedNonDecision || isPoolQuestionFinalized(details)) return undefined
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, outcome)
	if (selectedSide === undefined || largestOtherBalance < details.nonDecisionThresholdAttoRep) return undefined
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	return availableRoom === 0n ? undefined : availableRoom
}
export function reportingContributionTriggersFork(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey | undefined, amount: bigint | undefined) {
	if (outcome === undefined || amount === undefined) return false
	const forkTriggerAmount = getReportingForkTriggerAmount(details, outcome)
	return forkTriggerAmount !== undefined && amount >= forkTriggerAmount
}
/** A fork needs two sides at the non-decision threshold, so the second-largest side measures how close the game is to forking. */
export function getSecondLargestEscalationBalance(sides: readonly { balance: bigint | undefined }[]) {
	const [, secondLargest] = sides
		.map(side => side.balance ?? 0n)
		.sort((left, right) => {
			if (left > right) return -1
			return left < right ? 1 : 0
		})
	return secondLargest ?? 0n
}
function getMaxProfitContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	if (getReportingForkTriggerAmount(details, selectedOutcome) !== undefined) return { amountAttoRep: undefined, reason: reportingCopy.maxProfitForkReason }
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amountAttoRep === undefined)
		return {
			amountAttoRep: undefined,
			reason: minContribution.reason ?? 'Max reward preset is unavailable.',
		}
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: 'Selected side is unavailable.' }
	const rewardEligibleCap = largestOtherBalance + largestOtherBalance / 2n
	const targetFinalBalance = rewardEligibleCap < details.nonDecisionThresholdAttoRep ? rewardEligibleCap : details.nonDecisionThresholdAttoRep
	if (isUniqueWinner(selectedSide.balance, largestOtherBalance) && selectedSide.balance >= targetFinalBalance)
		return {
			amountAttoRep: undefined,
			reason: reportingCopy.maxProfitWindowFilledReason,
		}
	const requiredWindowAmount = targetFinalBalance > selectedSide.balance ? targetFinalBalance - selectedSide.balance : 0n
	const minimumEnteredAmount = minContribution.amountAttoRep > requiredWindowAmount ? minContribution.amountAttoRep : requiredWindowAmount
	const amountAttoRep = details.startBondAttoRep > minimumEnteredAmount ? details.startBondAttoRep : minimumEnteredAmount
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amountAttoRep > availableRoom ? availableRoom : amountAttoRep
	if (selectedSide.balance + effectiveAmount < targetFinalBalance)
		return {
			amountAttoRep: undefined,
			reason: 'Max reward preset unavailable because the selected side cannot fill the reward window within the remaining bond capacity.',
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

export function previewReportingDeadline(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint) {
	if (amount <= 0n || previewReportingContribution(details, outcome, amount).reason !== undefined) return undefined
	if (details.status === 'not-started') return { deadline: details.currentTime + ESCALATION_GAME_ACTIVATION_DELAY, extension: ESCALATION_GAME_ACTIVATION_DELAY, reachesNonDecision: false }
	if (details.systemState !== 'operational' || details.hasReachedNonDecision || isPoolQuestionFinalized(details) || details.currentTime > details.escalationEndTime) return undefined
	const projected = projectEscalationDeposit({ amountAttoRep: amount, balancesAttoRep: getEscalationBalanceTuple(details.sides), nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep, outcome, startBondAttoRep: details.startBondAttoRep })
	if (projected === undefined) return undefined
	if (projected.reachesNonDecision) return { deadline: details.currentTime, extension: 0n, reachesNonDecision: true }
	const balances = [...projected.projectedBalancesAttoRep].sort((a, b) => {
		if (a < b) return -1
		return a > b ? 1 : 0
	})
	const elapsed = computeEscalationTimeSinceStartFromAttritionCostAttoRep(details.startBondAttoRep, details.nonDecisionThresholdAttoRep, balances[1] ?? 0n)
	let deadline = details.activationTime + elapsed
	if (details.forkContinuation) {
		if (details.forkResumedAt === undefined || details.forkElapsedAtStart === undefined || details.forkResumedAt === 0n) return undefined
		const remaining = elapsed > details.forkElapsedAtStart ? elapsed - details.forkElapsedAtStart : 0n
		deadline = details.forkResumedAt + (remaining > ESCALATION_GAME_ACTIVATION_DELAY ? remaining : ESCALATION_GAME_ACTIVATION_DELAY)
	}
	return { deadline, extension: deadline > details.escalationEndTime ? deadline - details.escalationEndTime : 0n, reachesNonDecision: false }
}
