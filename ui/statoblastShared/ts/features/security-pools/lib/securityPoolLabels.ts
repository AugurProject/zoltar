import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { SecurityPoolLifecycleState } from './securityPoolState.js'
import type { BadgeTone } from '@zoltar/ui-core-shared/types/components.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { PoolStateFilter } from '../../../types/app.js'

export type VaultLauncherAction = 'claim-fees' | 'deposit-rep' | 'rep-exit'
export type VaultRepExitMode = 'redeem' | 'withdraw'

export function formatSecurityPoolPageSummary(matchingPoolCount: number, loadedPoolCount: number) {
	const poolLabel = loadedPoolCount === 1 ? securityPoolCopy.poolCountSingular : securityPoolCopy.poolCountPlural
	const matchVerb = matchingPoolCount === 1 ? securityPoolCopy.poolSummarySingularVerb : securityPoolCopy.poolSummaryPluralVerb
	return securityPoolCopy.formatPoolPageSummary(matchingPoolCount, loadedPoolCount, poolLabel, matchVerb)
}

export function getVaultLauncherWalletReason(action: VaultLauncherAction, repExitMode: VaultRepExitMode) {
	if (action === 'claim-fees') return securityPoolCopy.connectWalletBeforeClaimingFees
	if (action === 'deposit-rep') return securityPoolCopy.connectWalletBeforeDepositingRep
	if (action === 'rep-exit') return repExitMode === 'redeem' ? securityPoolCopy.connectWalletBeforeRedeemingRep : securityPoolCopy.connectWalletBeforeWithdrawingRep
	return assertNever(action)
}

export function getVaultLauncherVaultOwnerReason(action: VaultLauncherAction, repExitMode: VaultRepExitMode) {
	if (action === 'claim-fees') return securityPoolCopy.selectOwnVaultToClaimFees
	if (action === 'deposit-rep') return securityPoolCopy.selectOwnVaultToDepositRep
	if (action === 'rep-exit') return repExitMode === 'redeem' ? securityPoolCopy.selectOwnVaultToRedeemRep : securityPoolCopy.selectOwnVaultToWithdrawRep
	return assertNever(action)
}

/** The browse filter a lifecycle state belongs to; a forked pool shares the Fork migration badge, so it shares that filter. */
export function getPoolStateFilter(lifecycleState: SecurityPoolLifecycleState): Exclude<PoolStateFilter, 'all'> {
	return lifecycleState === 'poolForked' ? 'forkMigration' : lifecycleState
}

/** One name per pool state, shared by the browse filter and the pool status badge so both use the same words. */
export function getPoolStateLabel(state: Exclude<PoolStateFilter, 'all'>) {
	if (state === 'operational') return commonCopy.operational
	if (state === 'ended') return securityPoolCopy.finalized
	if (state === 'forkMigration') return securityPoolCopy.forkMigration
	if (state === 'forkTruthAuction') return commonCopy.truthAuction
	return assertNever(state)
}

export function getSecurityPoolStatusBadgeLabel({ hasForkActivity, questionOutcome, lifecycleState }: { hasForkActivity: boolean; questionOutcome?: ReportingOutcomeKey | 'none'; lifecycleState: SecurityPoolLifecycleState | undefined }) {
	if (lifecycleState === undefined) return 'Unknown'
	if (lifecycleState === 'ended' && questionOutcome !== undefined && questionOutcome !== 'none') return securityPoolCopy.formatFinalizedAs(getReportingOutcomeLabel(questionOutcome))
	if (lifecycleState === 'operational' && hasForkActivity) return securityPoolCopy.forkFinalized
	return getPoolStateLabel(getPoolStateFilter(lifecycleState))
}

export function getSecurityPoolStatusBadgeTone(lifecycleState: SecurityPoolLifecycleState | undefined): BadgeTone {
	if (lifecycleState === 'operational') return 'ok'
	if (lifecycleState === undefined) return 'muted'
	return 'warning'
}
