export type LogRange = Readonly<{ fromBlock: bigint; toBlock: bigint }>

export class LogScanError extends Error {
	readonly logRange: LogRange

	constructor(logRange: LogRange, options: { cause?: unknown }) {
		let causeMessage: string | undefined
		if (options.cause instanceof Error) causeMessage = options.cause.message
		else if (typeof options.cause === 'string') causeMessage = options.cause
		super(`Log scan failed for blocks ${logRange.fromBlock.toString()} through ${logRange.toBlock.toString()}${causeMessage === undefined ? '' : `: ${causeMessage}`}`, options)
		this.name = 'LogScanError'
		this.logRange = logRange
	}
}

function walkErrorCauses(error: unknown, visit: (current: object) => boolean) {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (visit(current)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export function logRangeLimitError(error: unknown) {
	return walkErrorCauses(error, current => {
		if (!('message' in current) || typeof current.message !== 'string') return false
		const message = current.message.toLowerCase()
		if (message.includes('fromblock exceeds toblock')) return false
		if (message.includes('http 413') || message.includes('range is too large')) return true
		if (message.includes('response exceeds') || message.includes('response too large')) return true
		const mentionsRangeCap = message.includes('range') || message.includes('blocks') || message.includes('results') || message.includes('response size')
		const mentionsExceeding = message.includes('limit') || message.includes('too many') || message.includes('exceed') || message.includes('too large') || message.includes('maximum') || message.includes('up to') || message.includes('more than')
		return mentionsRangeCap && mentionsExceeding
	})
}

export async function fetchLogsWithAdaptiveRanges<Log>(fromBlock: bigint, toBlock: bigint, maximumRange: bigint, fetchRange: (logRange: LogRange) => Promise<readonly Log[]>): Promise<Log[]> {
	if (maximumRange < 1n) throw new Error('maximumRange must be positive')
	const logs: Log[] = []
	let nextBlock = fromBlock
	let requestedBlocks = maximumRange
	while (nextBlock <= toBlock) {
		const remaining = toBlock - nextBlock + 1n
		const attemptedBlocks = requestedBlocks < remaining ? requestedBlocks : remaining
		const range = { fromBlock: nextBlock, toBlock: nextBlock + attemptedBlocks - 1n }
		try {
			logs.push(...(await fetchRange(range)))
			nextBlock = range.toBlock + 1n
			requestedBlocks = maximumRange
		} catch (error) {
			if (attemptedBlocks > 1n && logRangeLimitError(error)) {
				requestedBlocks = (attemptedBlocks + 1n) / 2n
				continue
			}
			throw new LogScanError(range, { cause: error })
		}
	}
	return logs
}
