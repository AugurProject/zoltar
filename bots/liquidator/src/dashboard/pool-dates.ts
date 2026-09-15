import { h, render } from 'preact'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'

/** @internal Exported for timestamp validation tests. */
export function poolDateTimestamp(timestamp: string | undefined) {
	if (timestamp === undefined || !/^\d+$/.test(timestamp)) return undefined
	const seconds = BigInt(timestamp)
	return seconds > 8_640_000_000_000n ? undefined : seconds
}

export function renderPoolDate(root: HTMLElement, timestamp: string | undefined, currentTimestamp: bigint) {
	render(h(TimestampValue, { timestamp: poolDateTimestamp(timestamp), currentTimestamp, undefinedText: 'Unavailable' }), root)
}

export function clearPoolDate(root: HTMLElement) {
	render(undefined, root)
}
