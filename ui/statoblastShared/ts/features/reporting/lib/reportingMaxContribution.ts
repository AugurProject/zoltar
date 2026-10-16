import * as reportingCopy from '../../../copy/reporting.js'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { getLiquidationMigrationSecurityMultiplierBps } from '@zoltar/statoblast-shared/statoblast/liquidation'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import { getCapacityOwnershipBackedRepFloor } from '../../security-pools/lib/securityVault.js'
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
	if (details === undefined) return { amountAttoRep: undefined, reason: reportingCopy.loadingReportingDetails }
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

function getPositiveDifference(left: bigint, right: bigint) {
	return left > right ? left - right : 0n
}

/**
 * The vault REP `SecurityPool.depositToEscalationGame` accepts from the viewer's vault now, or undefined while it is unknown.
 * Reported REP still counts toward the vault's associated requirement as dispute stake, but the vault and the pool must
 * each keep their migration reserve in pool-held REP, and a partial report must leave at least the vault minimum. The pool
 * rounds the escrowed backing units up, so a partial maximum keeps a margin of one backing unit's REP plus one attoREP.
 */
export function getReportableVaultRepAttoRep(details: Pick<ReportingDetails, 'viewerPoolHeldVaultRepBackingAttoRep' | 'viewerVaultDisputeStakedAttoRep' | 'viewerVaultReportingLimits'> | undefined) {
	const backingAttoRep = details?.viewerPoolHeldVaultRepBackingAttoRep
	const limits = details?.viewerVaultReportingLimits
	if (backingAttoRep === undefined || limits === undefined) return undefined
	if (backingAttoRep === 0n || limits.totalRepBackingUnits === 0n || limits.totalPoolHeldAttoRep === 0n) return 0n
	const roundingMarginAttoRep = ceilDiv(limits.totalPoolHeldAttoRep, limits.totalRepBackingUnits) + 1n
	let coverageMaximumAttoRep = backingAttoRep
	if (limits.totalUnderwritingLimitAttoEth > 0n) {
		const migrationMultiplierBps = getLiquidationMigrationSecurityMultiplierBps(limits.statoblastSecurityMultiplierBps)
		const vaultAssociatedRepAttoRep = getCapacityOwnershipBackedRepFloor(limits.underwritingLimitAttoEth, limits.repPerEthPrice, limits.statoblastSecurityMultiplierBps)
		const vaultMigrationRepAttoRep = getCapacityOwnershipBackedRepFloor(limits.underwritingLimitAttoEth, limits.repPerEthPrice, migrationMultiplierBps)
		const poolMigrationRepAttoRep = getCapacityOwnershipBackedRepFloor(limits.totalUnderwritingLimitAttoEth, limits.repPerEthPrice, migrationMultiplierBps)
		// Without a price the pool cannot check coverage, so it rejects every vault-funded report.
		if (vaultAssociatedRepAttoRep === undefined || vaultMigrationRepAttoRep === undefined || poolMigrationRepAttoRep === undefined) return 0n
		if (backingAttoRep + (details?.viewerVaultDisputeStakedAttoRep ?? 0n) < vaultAssociatedRepAttoRep + roundingMarginAttoRep) return 0n
		const vaultMaximumAttoRep = limits.underwritingLimitAttoEth === 0n ? backingAttoRep : getPositiveDifference(backingAttoRep, vaultMigrationRepAttoRep + roundingMarginAttoRep)
		const poolMaximumAttoRep = getPositiveDifference(limits.totalPoolHeldAttoRep, poolMigrationRepAttoRep)
		coverageMaximumAttoRep = vaultMaximumAttoRep < poolMaximumAttoRep ? vaultMaximumAttoRep : poolMaximumAttoRep
		if (coverageMaximumAttoRep > backingAttoRep) coverageMaximumAttoRep = backingAttoRep
	}
	if (limits.minimumVaultRepDepositAttoRep === 0n) return coverageMaximumAttoRep
	// Reporting the whole backing empties the vault only when the rounded-up escrow takes every backing unit.
	const emptiesVault = ceilDiv(backingAttoRep * limits.totalRepBackingUnits, limits.totalPoolHeldAttoRep) === limits.vaultRepBackingUnits
	if (coverageMaximumAttoRep === backingAttoRep && emptiesVault) return backingAttoRep
	const partialMaximumAttoRep = getPositiveDifference(backingAttoRep, limits.minimumVaultRepDepositAttoRep + roundingMarginAttoRep)
	return coverageMaximumAttoRep < partialMaximumAttoRep ? coverageMaximumAttoRep : partialMaximumAttoRep
}
