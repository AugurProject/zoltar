import * as securityPoolCopy from '../../../copy/securityPool.js'
import { assertNever } from '../../../lib/assert.js'
import type { SecurityPoolLifecycleState } from './securityPoolState.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import type { ReportingOutcomeKey } from '../../../types/contracts.js'

type VaultLauncherAction = 'claim-fees' | 'deposit-rep' | 'rep-exit' | 'set-bond-allowance'
type RepExitMode = 'redeem' | 'withdraw'

export function formatSecurityPoolPageSummary(matchingPoolCount: number, loadedPoolCount: number) {
	const poolLabel = loadedPoolCount === 1 ? securityPoolCopy.poolCountSingular : securityPoolCopy.poolCountPlural
	const matchVerb = matchingPoolCount === 1 ? securityPoolCopy.poolSummarySingularVerb : securityPoolCopy.poolSummaryPluralVerb
	return securityPoolCopy.formatPoolPageSummary(matchingPoolCount, loadedPoolCount, poolLabel, matchVerb)
}

export function getVaultLauncherWalletReason(action: VaultLauncherAction, repExitMode: RepExitMode) {
	if (action === 'claim-fees') return securityPoolCopy.connectWalletBeforeClaimingFees
	if (action === 'deposit-rep') return securityPoolCopy.connectWalletBeforeDepositingRep
	if (action === 'rep-exit') return repExitMode === 'redeem' ? securityPoolCopy.connectWalletBeforeRedeemingRep : securityPoolCopy.connectWalletBeforeWithdrawingRep
	return securityPoolCopy.connectWalletBeforeSettingBondAllowance
}

export function getVaultLauncherOwnershipReason(action: VaultLauncherAction, repExitMode: RepExitMode) {
	if (action === 'claim-fees') return securityPoolCopy.selectOwnVaultToClaimFees
	if (action === 'deposit-rep') return securityPoolCopy.selectOwnVaultToDepositRep
	if (action === 'rep-exit') return repExitMode === 'redeem' ? securityPoolCopy.selectOwnVaultToRedeemRep : securityPoolCopy.selectOwnVaultToWithdrawRep
	return securityPoolCopy.selectOwnVaultToSetBondAllowance
}

export function getSecurityPoolLifecycleLabel(state: SecurityPoolLifecycleState | undefined) {
	if (state === undefined) return 'Unknown'

	switch (state) {
		case 'operational':
			return 'Operational'
		case 'ended':
			return 'Ended'
		case 'poolForked':
			return 'Pool Forked'
		case 'forkMigration':
			return 'Fork Migration'
		case 'forkTruthAuction':
			return 'Truth Auction'
		default:
			return assertNever(state)
	}
}

export function getSecurityPoolStatusBadgeLabel({ hasForkActivity, questionOutcome, lifecycleState }: { hasForkActivity: boolean; questionOutcome?: ReportingOutcomeKey | 'none'; lifecycleState: SecurityPoolLifecycleState | undefined }) {
	if (lifecycleState === undefined) return 'Unknown'
	if (lifecycleState === 'poolForked' || lifecycleState === 'forkMigration') return 'Fork Migration'
	if (lifecycleState === 'forkTruthAuction') return 'Truth Auction'
	if (lifecycleState === 'ended') {
		if (questionOutcome === undefined || questionOutcome === 'none') return 'Finalized'
		return `Finalized as ${getReportingOutcomeLabel(questionOutcome)}`
	}
	if (lifecycleState === 'operational' && hasForkActivity) return 'Fork Finalized'
	return getSecurityPoolLifecycleLabel(lifecycleState)
}
