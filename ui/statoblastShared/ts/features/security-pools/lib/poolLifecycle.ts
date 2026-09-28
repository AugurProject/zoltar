import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { deriveSecurityPoolLifecycleState, type SecurityPoolLifecycleState } from './securityPoolState.js'
import type { SecurityPoolReportingStage } from './securityPoolState/types.js'
import type { SelectedPoolView } from './securityPoolWorkflow.js'

/** The user-facing sequence a pool moves through, from backing and trading to a final settlement. */
export const POOL_LIFECYCLE_STEPS = ['operational', 'escalation', 'forkMigration', 'truthAuction', 'settled'] as const
export type PoolLifecycleStep = (typeof POOL_LIFECYCLE_STEPS)[number]

export type PoolLifecycleStepInput = {
	/** The pool has recorded fork activity (a triggered fork, migration, or auction). */
	hasForkActivity: boolean
	lifecycleState: SecurityPoolLifecycleState | undefined
	/** The fork workflow reached its settlement stage (auction finalized and claims resolved). */
	forkSettled?: boolean | undefined
	/** From the loaded escalation game; `undefined` until reporting details load. */
	reportingStage?: SecurityPoolReportingStage | undefined
	/** Pool-level fallback while reporting details are not loaded: the question has ended or an escalation game already started. */
	reportingOpen: boolean
}

export function derivePoolLifecycleStep({ forkSettled = false, hasForkActivity, lifecycleState, reportingOpen, reportingStage }: PoolLifecycleStepInput): PoolLifecycleStep | undefined {
	if (lifecycleState === undefined) return undefined
	switch (lifecycleState) {
		case 'forkTruthAuction':
			return 'truthAuction'
		case 'poolForked':
		case 'forkMigration':
			return 'forkMigration'
		case 'ended':
			return 'settled'
		case 'operational':
			if (hasForkActivity) return forkSettled ? 'settled' : 'forkMigration'
			if (reportingStage === 'resolved') return 'settled'
			if (reportingStage === 'forkTriggered') return 'forkMigration'
			if (reportingStage === 'preOpen') return 'operational'
			if (reportingStage !== undefined) return 'escalation'
			return reportingOpen ? 'escalation' : 'operational'
		default:
			return assertNever(lifecycleState)
	}
}

/** The pool tab that holds the stage's main work, used when the pool URL does not name a tab. */
export function getDefaultPoolTab(step: PoolLifecycleStep | undefined, hasForkActivity: boolean): SelectedPoolView {
	switch (step) {
		case undefined:
		case 'operational':
			return 'vaults'
		case 'escalation':
			return 'reporting'
		case 'forkMigration':
		case 'truthAuction':
			return 'fork-workflow'
		case 'settled':
			return hasForkActivity ? 'fork-workflow' : 'trading'
		default:
			return assertNever(step)
	}
}

/** Whether Fork & Migration belongs with the main pool tabs instead of the secondary tools. */
export function isForkWorkflowPrimary(step: PoolLifecycleStep | undefined, hasForkActivity: boolean) {
	return hasForkActivity || step === 'forkMigration' || step === 'truthAuction'
}

/** The stage a listed pool is in from its registry data alone, for pages that have not loaded reporting or fork details. */
export function deriveListedPoolLifecycleStep(pool: ListedSecurityPool, now: bigint | undefined) {
	const lifecycleState = deriveSecurityPoolLifecycleState({
		hasForkActivity: pool.hasForkActivity,
		isChildPool: pool.parent !== zeroAddress,
		questionOutcome: pool.questionOutcome,
		systemState: pool.systemState,
		universeHasForked: pool.universeHasForked,
	})
	const reportingOpen = pool.ordinaryEscalationGameStarted || (now !== undefined && now >= pool.marketDetails.endTime)
	return { lifecycleState, step: derivePoolLifecycleStep({ hasForkActivity: pool.hasForkActivity, lifecycleState, reportingOpen }) }
}
