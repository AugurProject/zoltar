import * as zoltarCopy from '../../../copy/zoltar.js'

/** Why one question cannot fork a universe yet: the chain time is still unknown, or the question has not ended. Forking needs `block.timestamp >= endTime`. */
export function getForkQuestionTimingReason(endTime: bigint, currentTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined) return zoltarCopy.forkQuestionTimeLoadingReason
	return currentTimestamp < endTime ? zoltarCopy.questionNotEndedForkReason : undefined
}
