import { type OperatorState, clearPollFailureMetadata } from '#state/operator-state'
import { operatorStatusAfterPause } from '@zoltar/bot-shared/monitoring/block-sync'

type SuccessfulPollState = Pick<OperatorState, 'marketAvailability' | 'consecutivePollFailures' | 'lastError' | 'lastPollFailureAt' | 'lastRetryAt' | 'nextRetryAt' | 'paused' | 'retryInProgress' | 'status'>

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
