import type { QuestionRecord } from './browser-types.ts'
import { utcDateTime } from './format.ts'

export const questionStatus = (question: Pick<QuestionRecord, 'start_time' | 'end_time'>, nowMilliseconds = Date.now()): string => {
	const now = BigInt(Math.floor(nowMilliseconds / 1000))
	if (now < BigInt(question.start_time)) return 'Scheduled'
	if (now < BigInt(question.end_time)) return 'Open'
	return 'Ended'
}

/** A question start time; zero is the protocol's "start immediately", not the Unix epoch. */
export const questionStartLabel = (seconds: string): string => (BigInt(seconds) === 0n ? 'Immediately after creation' : questionDateLabel(seconds))

/** The answer type the Zoltar registry shows: Yes/No outcomes are binary, no outcomes with ticks are scalar, anything else categorical. */
export const questionAnswerType = (question: Pick<QuestionRecord, 'outcome_options' | 'num_ticks'>): 'Binary' | 'Scalar' | 'Categorical' => {
	const outcomes = question.outcome_options
	if (outcomes.length === 0 && /^\d+$/.test(question.num_ticks) && BigInt(question.num_ticks) > 0n) return 'Scalar'
	if (outcomes.length === 2 && outcomes[0] === 'Yes' && outcomes[1] === 'No') return 'Binary'
	return 'Categorical'
}

export const questionDateLabel = (seconds: string): string => {
	const milliseconds = BigInt(seconds) * 1000n
	if (milliseconds > 8_640_000_000_000_000n || milliseconds < -8_640_000_000_000_000n) return `Date out of range (${seconds} Unix seconds)`
	return utcDateTime(Number(milliseconds))
}
