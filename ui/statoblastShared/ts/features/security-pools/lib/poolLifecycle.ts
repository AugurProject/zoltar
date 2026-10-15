import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { hasEscalationGame } from '../../markets/lib/trading.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'
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

/** The stages a settled pool passed over: the fork stages when it settled without a fork, and escalation too when no escalation game ever started. */
export function getSkippedLifecycleSteps({ escalationStarted, hasForkActivity, step }: { escalationStarted: boolean; hasForkActivity: boolean; step: PoolLifecycleStep | undefined }): PoolLifecycleStep[] {
	if (step !== 'settled' || hasForkActivity) return []
	return escalationStarted ? ['forkMigration', 'truthAuction'] : ['escalation', 'forkMigration', 'truthAuction']
}

/**
 * Whether an escalation game pauses an operating pool's minting. The escalation flags stay set after the game, when
 * finalization or a fork has closed minting for good, so a pool in any other stage is not "paused".
 */
export function isMintingPausedByEscalation(pool: Parameters<typeof hasEscalationGame>[0], lifecycleState: SecurityPoolLifecycleState | undefined) {
	return (lifecycleState === 'operational' || lifecycleState === undefined) && hasEscalationGame(pool)
}

/** Whether the pool is in a fork stage: forked, migrating, or running its truth auction. */
export function isForkLifecycleState(state: SecurityPoolLifecycleState | undefined) {
	return state === 'poolForked' || state === 'forkMigration' || state === 'forkTruthAuction'
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
