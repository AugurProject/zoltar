import { hasEscalationGame } from '../../markets/lib/trading.js'
import type { QuestionLedgerLifecycleState } from './questionLedgerState.js'

/** Reporting closes minting while a question's outcome is being resolved. */
export function isMintingPausedByEscalation(pool: Parameters<typeof hasEscalationGame>[0], lifecycleState: QuestionLedgerLifecycleState | undefined) {
	return (lifecycleState === 'operational' || lifecycleState === undefined) && hasEscalationGame(pool)
}
