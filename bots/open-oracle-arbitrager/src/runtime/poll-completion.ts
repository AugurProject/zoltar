import type { OperatorState } from '#state/operator-state'
import { operatorStatusAfterPause } from '@zoltar/bot-shared/monitoring/block-sync'

type PollFailureMetadata = Pick<OperatorState, 'consecutivePollFailures' | 'lastPollFailureAt' | 'lastRetryAt' | 'nextRetryAt' | 'retryInProgress'>

type SuccessfulPollState = Pick<OperatorState, 'marketAvailability' | 'lastError' | 'paused' | 'status'> & PollFailureMetadata

function clearPollFailureMetadata(state: PollFailureMetadata) {
	state.consecutivePollFailures = 0
	state.lastPollFailureAt = undefined
	state.lastRetryAt = undefined
	state.nextRetryAt = undefined
	state.retryInProgress = false
}

export function completeSuccessfulPoll(state: SuccessfulPollState, nextError: string | undefined, stopAfterPoll: boolean) {
	clearPollFailureMetadata(state)
	if (state.marketAvailability?.kind === 'missing-deployment') state.marketAvailability = undefined
	state.lastError = nextError
	state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
	return stopAfterPoll
}

export function completeUnconfiguredPoll(state: SuccessfulPollState) {
	const stop = completeSuccessfulPoll(state, undefined, false)
	state.status = 'paused'
	return stop
}
