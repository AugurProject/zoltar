import { getSecondLargestEscalationBalance, getStrictLeadingEscalationOutcome } from '../../../lib/reportingOutcomeBalances.js'
import * as reportingCopy from '../../../copy/reporting.js'
import {
	getWinningEscalationDepositClaimAmount as computeWinningEscalationDepositClaimAmount,
	getWinningImportedEscalationDepositClaimAmount as computeWinningImportedEscalationDepositClaimAmount,
	ESCALATION_ACTIVATION_DELAY,
	projectEscalationDeposit,
	projectEscalationEndTime,
	type EscalationBalanceTuple,
} from '@zoltar/statoblast-shared/escalationGame/escalationMath'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActiveReportingDetails, EscalationDeposit, EscalationSide, ImportedEscalationDeposit, ReportingDetails } from '../../../types/contracts.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'

export { getSecondLargestEscalationBalance, getStrictLeadingEscalationOutcome }

type ReportingAmountSuggestion = {
	amountAttoRep: bigint | undefined
	reason: string | undefined
}
export const ESCALATION_GAME_ACTIVATION_DELAY = ESCALATION_ACTIVATION_DELAY
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.loadingReportingDetails
const MAX_PROFIT_NOT_STARTED_REASON = reportingCopy.maxProfitPrestartReason
const SELECTED_SIDE_ALREADY_LEADS_REASON = reportingCopy.selectedSideLeadsReason
const ESCALATION_RESOLVED_REASON = reportingCopy.reportingAlreadyResolved
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
function getContinuationTiming(details: ActiveReportingDetails) {
	if (!details.forkContinuation || details.forkResumedAt === undefined || details.forkElapsedAtStart === undefined) return undefined
	return { forkElapsedAtStart: details.forkElapsedAtStart, forkResumedAt: details.forkResumedAt }
}
function getWinningEscalationDepositClaimAmount(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, deposit: Pick<EscalationDeposit, 'amountAttoRep' | 'cumulativeAmountAttoRep'>) {
	const winningOutcomeBalance = details.sides.find(side => side.key === outcome)?.balance
	if (winningOutcomeBalance === undefined) return undefined
	return computeWinningEscalationDepositClaimAmount({
		bindingCapitalAttoRep: details.bindingCapital,
		cumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
		depositAmountAttoRep: deposit.amountAttoRep,
		forkThresholdAttoRep: details.forkThresholdAttoRep,
		nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep,
		winningOutcomeBalanceAttoRep: winningOutcomeBalance,
		ordinarySettlement: !details.forkContinuation && !details.hasReachedNonDecision,
	})
}
function getWinningImportedEscalationDepositClaimAmount(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, deposit: ImportedEscalationDeposit) {
	const winningOutcomeBalance = details.sides.find(side => side.key === outcome)?.balance
	if (winningOutcomeBalance === undefined) return undefined
	return computeWinningImportedEscalationDepositClaimAmount({
		bindingCapitalAttoRep: details.bindingCapital,
		postDepositCumulativeAmountAttoRep: deposit.cumulativeAmountAttoRep,
		depositAmountAttoRep: deposit.amountAttoRep,
		principalAttoRep: deposit.amountAttoRep,
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

export function getKnownReportingClaimAmount(details: ReportingDetails | undefined) {
	if (details?.status !== 'active' || details.settlementState !== 'resolved') return 0n
	const winner = details.sides.find(side => side.key === details.questionOutcome)
	if (winner === undefined) return 0n
	const local = winner.userDeposits.reduce((sum, deposit) => sum + (getEscalationDepositClaimAmount(details, winner.key, deposit) ?? 0n), 0n)
	const inherited = winner.importedUserDeposits.reduce((sum, deposit) => sum + (deposit.claimIdentity === undefined ? 0n : (getImportedEscalationDepositClaimAmount(details, winner.key, deposit) ?? 0n)), 0n)
	return local + inherited
}

export function getRemainingSelectedOutcomeContributionCapacity(details: ReportingDetails, outcome: ReportingOutcomeKey) {
	if (details.status === 'not-started') return details.nonDecisionThresholdAttoRep
	const selectedSide = details.sides.find(side => side.key === outcome)
	if (selectedSide === undefined) return 0n
	return details.nonDecisionThresholdAttoRep > selectedSide.balance ? details.nonDecisionThresholdAttoRep - selectedSide.balance : 0n
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
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: reportingCopy.selectedSideIsUnavailable }
	if ((isPoolQuestionFinalized(details) && details.questionOutcome === selectedOutcome) || isUniqueWinner(selectedSide.balance, largestOtherBalance)) return { amountAttoRep: 0n, reason: undefined }
	const requiredLeadAmount = largestOtherBalance + 1n - selectedSide.balance
	const amountAttoRep = details.startBondAttoRep > requiredLeadAmount ? details.startBondAttoRep : requiredLeadAmount
	const availableRoom = getAvailableRoom(details, selectedSide.balance)
	const effectiveAmount = amountAttoRep > availableRoom ? availableRoom : amountAttoRep
	if (availableRoom === 0n)
		return {
			amountAttoRep: undefined,
			reason: reportingCopy.selectedSideCapacityEmpty,
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
function getMaxProfitContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion {
	if (getReportingForkTriggerAmount(details, selectedOutcome) !== undefined) return { amountAttoRep: undefined, reason: reportingCopy.maxProfitForkReason }
	const minContribution = getMinimumOutcomeChangeContribution(details, selectedOutcome)
	if (minContribution.amountAttoRep === undefined)
		return {
			amountAttoRep: undefined,
			reason: minContribution.reason ?? reportingCopy.maxProfitUnavailable,
		}
	const { largestOtherBalance, selectedSide } = getSelectedAndOtherSides(details, selectedOutcome)
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: reportingCopy.selectedSideIsUnavailable }
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
			reason: reportingCopy.maxProfitOutsideCapacity,
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
			/** The game trimmed the offer by 1 attoREP because it would otherwise tie the leading outcome. */
			tieAdjusted: boolean
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
			reason: ESCALATION_RESOLVED_REASON,
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
			reason: `Enter at least ${formatCurrencyBalanceWithUnit(details.startBondAttoRep, 'REP')} to meet the minimum first report.`,
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
			reason: reportingCopy.invalidReportAmount,
		}
	return {
		actualDepositAmount: projectedDeposit.acceptedAmountAttoRep,
		reason: undefined,
		tieAdjusted: projectedDeposit.tieAdjusted,
	}
}
export function previewReportingContribution(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingContributionPreview {
	if (details.status === 'not-started') {
		if (amount < details.startBondAttoRep)
			return {
				actualDepositAmount: undefined,
				reason: reportingCopy.minimumReportRequired(formatCurrencyBalanceWithUnit(details.startBondAttoRep, 'REP')),
			}
		return {
			actualDepositAmount: amount,
			reason: undefined,
			tieAdjusted: false,
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
	const continuation = getContinuationTiming(details)
	if (details.forkContinuation && (continuation === undefined || continuation.forkResumedAt === 0n)) return undefined
	const projectedDeadline = projectEscalationEndTime({
		activationTime: details.activationTime,
		balancesAttoRep: projected.projectedBalancesAttoRep,
		continuation,
		nonDecisionThresholdAttoRep: details.nonDecisionThresholdAttoRep,
		startBondAttoRep: details.startBondAttoRep,
	})
	// A report never moves the deadline earlier.
	const deadline = projectedDeadline > details.escalationEndTime ? projectedDeadline : details.escalationEndTime
	return { deadline, extension: deadline - details.escalationEndTime, reachesNonDecision: false }
}

function knownReportingReturn(details: ActiveReportingDetails, leader: ReportingOutcomeKey | undefined) {
	const winner = details.sides.find(side => side.key === leader)
	if (winner === undefined) return undefined
	const local = winner.userDeposits.reduce((sum, deposit) => sum + (getWinningEscalationDepositClaimAmount(details, winner.key, deposit) ?? 0n), 0n)
	return local + winner.importedUserDeposits.reduce((sum, deposit) => sum + (getWinningImportedEscalationDepositClaimAmount(details, winner.key, deposit) ?? 0n), 0n)
}

/** Models accepted stake and payouts at the new balances, keeping payout estimates scoped to deposits this device can verify. */
export function previewReportingComparison(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint) {
	const acceptedAmount = previewReportingContribution(details, outcome, amount).actualDepositAmount
	const deadlinePreview = previewReportingDeadline(details, outcome, amount)
	if (acceptedAmount === undefined || deadlinePreview === undefined) return undefined
	if (details.status === 'not-started') {
		if (acceptedAmount > details.nonDecisionThresholdAttoRep) return undefined
		return {
			payoutBefore: 0n,
			payoutAfter: acceptedAmount,
			stakeBefore: 0n,
			stakeAfter: acceptedAmount,
			leaderBefore: undefined,
			leaderAfter: outcome,
			endsBefore: undefined,
			endsAfter: deadlinePreview.deadline,
			endsUndecided: false,
			missingDeposits: false,
		}
	}
	const side = details.sides.find(candidate => candidate.key === outcome)
	if (side === undefined) return undefined
	const localStake = side.localPrincipalAttoRep ?? side.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)
	const stakeBefore = localStake + side.importedUserDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)
	const newBalance = side.balance + acceptedAmount
	const sides = details.sides.map(candidate => (candidate.key === outcome ? { ...candidate, balance: newBalance } : candidate))
	const projected = { ...details, sides, bindingCapital: getSecondLargestEscalationBalance(sides) }
	const leaderBefore = details.sides.some(candidate => candidate.balance > 0n) ? getStrictLeadingEscalationOutcome(details.sides) : undefined
	const leaderAfter = deadlinePreview.reachesNonDecision ? undefined : getStrictLeadingEscalationOutcome(sides)
	const knownPayoutAfter = knownReportingReturn(projected, leaderAfter)
	const newDepositPayout = leaderAfter === outcome ? getWinningEscalationDepositClaimAmount(projected, outcome, { amountAttoRep: acceptedAmount, cumulativeAmountAttoRep: newBalance }) : 0n
	return {
		payoutBefore: knownReportingReturn(details, leaderBefore) ?? (details.sides.every(candidate => candidate.balance === 0n) ? 0n : undefined),
		payoutAfter: knownPayoutAfter === undefined || newDepositPayout === undefined ? undefined : knownPayoutAfter + newDepositPayout,
		stakeBefore,
		stakeAfter: stakeBefore + acceptedAmount,
		leaderBefore,
		leaderAfter,
		endsBefore: details.escalationEndTime,
		endsAfter: deadlinePreview.deadline,
		endsUndecided: deadlinePreview.reachesNonDecision,
		missingDeposits: details.sides.some(candidate => (candidate.localPrincipalAttoRep ?? 0n) > candidate.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)),
	}
}
