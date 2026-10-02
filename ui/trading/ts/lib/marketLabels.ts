import { tryGetSecurityPoolSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { liveCopy } from '../copy/live.js'
import * as outcomeCopy from '../copy/outcomes.js'
import { resolvedShareOutcome } from '../protocol/settlement.js'

/** Contract question outcome index 3 is the unresolved sentinel; anything else outside the reported range is unexpected. */
export function questionOutcomeLabel(questionOutcome: number) {
	const outcome = resolvedShareOutcome(questionOutcome)
	if (outcome !== undefined) return outcomeCopy.outcomeLabel(outcome)
	return questionOutcome === 3 ? liveCopy.unresolvedOutcome : liveCopy.unknownQuestionOutcome(questionOutcome)
}

export function systemStateLabel(systemState: number) {
	const state = tryGetSecurityPoolSystemState(systemState)
	return state === undefined ? liveCopy.unknownSystemState(systemState) : liveCopy[state]
}
