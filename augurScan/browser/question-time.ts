import type { QuestionRecord } from './browser-types.ts'

export const questionStatus = (question: Pick<QuestionRecord, 'start_time' | 'end_time'>, nowMilliseconds = Date.now()): string => {
	const now = BigInt(Math.floor(nowMilliseconds / 1000))
	if (now < BigInt(question.start_time)) return 'Scheduled'
	if (now < BigInt(question.end_time)) return 'Open'
	return 'Ended'
}

export const questionDateLabel = (seconds: string): string => {
	const milliseconds = BigInt(seconds) * 1000n
	if (milliseconds > 8_640_000_000_000_000n || milliseconds < -8_640_000_000_000_000n) return `Date out of range (${seconds} Unix seconds)`
	return new Date(Number(milliseconds)).toLocaleDateString('en-GB')
}
