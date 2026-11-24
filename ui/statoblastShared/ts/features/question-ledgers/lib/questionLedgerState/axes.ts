import type { QuestionLedgerLifecycleState } from './types.js'
import type { ReportingOutcomeKey, QuestionLedgerSystemState } from '@zoltar/ui-core-shared/types/contracts.js'

/** Final outcomes come from the canonical question resolver, including pre-fork finality. */
export function deriveQuestionLedgerLifecycleState({ questionOutcome, systemState, universeHasForked }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: QuestionLedgerSystemState | undefined; universeHasForked?: boolean | undefined }): QuestionLedgerLifecycleState | undefined {
	if (systemState === undefined) return undefined
	if (systemState === 'operational' && questionOutcome !== undefined && questionOutcome !== 'none') return 'ended'
	if (universeHasForked === true && systemState === 'operational') return 'poolForked'
	return systemState
}
