import * as reportingCopy from '../../../copy/reporting.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import { getReportingForkTriggerAmount, getRemainingSelectedOutcomeContributionCapacity, previewReportingContribution } from './reportingDomain.js'

type ReportingMaxContribution = { amountAttoRep: bigint | undefined; reason: string | undefined; stopsBelowFork?: boolean }

/** The amount the contribution field's Max fills: the selected side's remaining room, capped by the funding source. Max never triggers the fork unless the user has confirmed the fork warning. */
export function getReportingMaxContribution({
	availableReportingRep,
	details,
	forkConfirmed,
	selectedOutcome,
	usesWalletFunding,
}: {
	availableReportingRep: bigint | undefined
	details: ReportingDetails | undefined
	forkConfirmed: boolean
	selectedOutcome: ReportingOutcomeKey | undefined
	usesWalletFunding: boolean
}): ReportingMaxContribution {
	if (selectedOutcome === undefined) return { amountAttoRep: undefined, reason: reportingCopy.presetOutcomeSelectionRequired }
	if (details === undefined) return { amountAttoRep: undefined, reason: reportingCopy.presetDetailsRequired }
	if (availableReportingRep === undefined) return { amountAttoRep: undefined, reason: usesWalletFunding ? reportingCopy.loadingWalletRepBalance : reportingCopy.loadingPoolHeldVaultRepBacking }
	if (availableReportingRep <= 0n) return { amountAttoRep: undefined, reason: usesWalletFunding ? reportingCopy.walletRepBalanceEmpty : reportingCopy.poolHeldVaultRepBackingEmpty }
	const remainingCapacity = getRemainingSelectedOutcomeContributionCapacity(details, selectedOutcome)
	if (remainingCapacity <= 0n) return { amountAttoRep: undefined, reason: reportingCopy.selectedSideCapacityEmpty }
	if (details.status === 'not-started') {
		const cappedAmount = availableReportingRep < remainingCapacity ? availableReportingRep : remainingCapacity
		if (cappedAmount < details.startBondAttoRep) return { amountAttoRep: undefined, reason: reportingCopy.selectedSideBelowMinimumReason }
		return { amountAttoRep: cappedAmount, reason: undefined }
	}
	const selectedSide = details.sides.find(side => side.key === selectedOutcome)
	if (selectedSide === undefined) return { amountAttoRep: undefined, reason: reportingCopy.selectedSideIsUnavailable }
	const maxContributionPreview = previewReportingContribution(details, selectedOutcome, details.nonDecisionThresholdAttoRep - selectedSide.balance)
	if (maxContributionPreview.actualDepositAmount === undefined) return { amountAttoRep: undefined, reason: maxContributionPreview.reason }
	let cappedAmount = maxContributionPreview.actualDepositAmount
	if (cappedAmount > availableReportingRep) cappedAmount = availableReportingRep
	if (cappedAmount > remainingCapacity) cappedAmount = remainingCapacity
	const forkTriggerAmount = getReportingForkTriggerAmount(details, selectedOutcome)
	const stopsBelowFork = forkTriggerAmount !== undefined && cappedAmount >= forkTriggerAmount && !forkConfirmed
	if (stopsBelowFork) cappedAmount = forkTriggerAmount - 1n
	if (cappedAmount < details.startBondAttoRep) return { amountAttoRep: undefined, reason: stopsBelowFork ? reportingCopy.maxBelowForkReason : reportingCopy.selectedSideBelowMinimumReason }
	return { amountAttoRep: cappedAmount, reason: undefined, stopsBelowFork }
}
