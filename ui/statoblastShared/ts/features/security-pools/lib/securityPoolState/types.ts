import type { SecurityPoolLifecycleState } from '../../../../types/app.js'
export type { SecurityPoolLifecycleState } from '../../../../types/app.js'
export type SecurityPoolStateInput = {
	lifecycleState?: SecurityPoolLifecycleState | undefined
	universeHasForked: boolean
}
export type SecurityPoolStateModel = SecurityPoolStateInput & {
	actions: Record<'createCompleteSet' | 'redeemCompleteSet' | 'migrateShares' | 'redeemShares', { enabled: boolean }>
}
