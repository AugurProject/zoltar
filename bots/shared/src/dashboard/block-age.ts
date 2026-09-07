export function blockAgeLabel(blockTimestamp: string | undefined, formatDuration: (seconds: number) => string, nowMilliseconds = Date.now()) {
	if (blockTimestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(blockTimestamp)) return 'timestamp unavailable'
	const timestampMilliseconds = Number(blockTimestamp) * 1_000
	if (!Number.isSafeInteger(timestampMilliseconds) || !Number.isFinite(nowMilliseconds)) return 'timestamp unavailable'
	const differenceSeconds = Math.floor(Math.abs(nowMilliseconds - timestampMilliseconds) / 1_000)
	const label = formatDuration(differenceSeconds)
	return nowMilliseconds >= timestampMilliseconds ? `seen ${label} ago` : `${label} ahead of local clock`
}
