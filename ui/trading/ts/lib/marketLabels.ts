import { getReportingOutcomeKey, tryGetSecurityPoolSystemState } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { liveCopy } from '../copy/live.js'
import * as outcomeCopy from '../copy/outcomes.js'
import type { ShareOutcome } from '../protocol/settlement.js'

const SHARE_OUTCOME_BY_KEY = { invalid: 'INVALID', yes: 'YES', no: 'NO' } as const satisfies Record<'invalid' | 'yes' | 'no', ShareOutcome>

/** The winning share for a resolved question, or undefined while the question is unresolved. */
export function resolvedShareOutcome(questionOutcome: number): ShareOutcome | undefined {
	const key = getReportingOutcomeKey(questionOutcome)
	return key === 'none' ? undefined : SHARE_OUTCOME_BY_KEY[key]
}

function shareOutcomeLabel(outcome: ShareOutcome) {
	if (outcome === 'YES') return outcomeCopy.yes
	if (outcome === 'NO') return outcomeCopy.no
	return outcomeCopy.invalid
}

/** Contract question outcome index 3 is the unresolved sentinel; anything else outside the reported range is unexpected. */
export function questionOutcomeLabel(questionOutcome: number) {
	const outcome = resolvedShareOutcome(questionOutcome)
	if (outcome !== undefined) return shareOutcomeLabel(outcome)
	return questionOutcome === 3 ? liveCopy.unresolvedOutcome : liveCopy.unknownQuestionOutcome(questionOutcome)
}

export function systemStateLabel(systemState: number) {
	const state = tryGetSecurityPoolSystemState(systemState)
	return state === undefined ? liveCopy.unknownSystemState(systemState) : liveCopy[state]
}
