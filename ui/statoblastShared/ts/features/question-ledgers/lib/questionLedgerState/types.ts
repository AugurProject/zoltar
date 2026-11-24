import type { QuestionLedgerLifecycleState } from '../../../../types/app.js'
export type { QuestionLedgerLifecycleState } from '../../../../types/app.js'
export type QuestionLedgerStateInput = {
	lifecycleState?: QuestionLedgerLifecycleState | undefined
	universeHasForked: boolean
}
export type QuestionLedgerStateModel = QuestionLedgerStateInput & {
	actions: Record<'createCompleteSet' | 'redeemCompleteSet' | 'migrateShares' | 'redeemShares', { enabled: boolean }>
}
