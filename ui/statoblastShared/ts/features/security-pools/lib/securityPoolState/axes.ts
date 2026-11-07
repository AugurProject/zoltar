import type { SecurityPoolLifecycleState } from './types.js'
import type { ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'

/** Final outcomes come from the canonical question resolver, including pre-fork finality. */
export function deriveSecurityPoolLifecycleState({ questionOutcome, systemState, universeHasForked }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined; universeHasForked?: boolean | undefined }): SecurityPoolLifecycleState | undefined {
	if (systemState === undefined) return undefined
	if (systemState === 'operational' && questionOutcome !== undefined && questionOutcome !== 'none') return 'ended'
	if (universeHasForked === true && systemState === 'operational') return 'poolForked'
	return systemState
}
