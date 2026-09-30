import { element } from './dom.ts'

export const WAITING_FOR_BLOCK = 'Block — · waiting for first observation'

/** How long ago the block was produced by the local clock, or how far ahead of it the block claims to be. */
export function blockAge(blockTimestamp: string | undefined, nowMilliseconds: number, formatDuration: (seconds: number) => string) {
	if (blockTimestamp === undefined || !/^(?:0|[1-9]\d*)$/.test(blockTimestamp)) return 'timestamp unavailable'
	const timestampMilliseconds = Number(blockTimestamp) * 1_000
	if (!Number.isSafeInteger(timestampMilliseconds) || !Number.isFinite(nowMilliseconds)) return 'timestamp unavailable'
	const age = formatDuration(Math.floor(Math.abs(nowMilliseconds - timestampMilliseconds) / 1_000))
	return nowMilliseconds >= timestampMilliseconds ? `seen ${age} ago` : `${age} ahead of local clock`
}

/** The header's block line: the latest observed block and its age. Each bot chooses its own duration precision. */
export function blockStatusLabel(blockNumber: string | undefined, blockTimestamp: string | undefined, nowMilliseconds: number, formatDuration: (seconds: number) => string) {
	if (blockNumber === undefined) return WAITING_FOR_BLOCK
	return `Block ${blockNumber} · ${blockAge(blockTimestamp, nowMilliseconds, formatDuration)}`
}

/** Writes the block line into the shared operator header and any page element that mirrors it. */
export function renderBlockStatus(text: string, mirrors: readonly HTMLElement[] = []) {
	for (const target of [element('header-block-status'), ...mirrors]) {
		if (target.textContent !== text) target.textContent = text
	}
}
