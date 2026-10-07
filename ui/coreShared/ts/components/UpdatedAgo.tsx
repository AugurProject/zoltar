import { useEffect, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { formatUpdatedAgo, isUpdatedAgoStale, updatedAgoTickMilliseconds } from '../lib/freshness.js'
import { usePageVisible } from '../hooks/useDataRefresh.js'
import { formatTimestamp } from '../lib/formatters.js'

type UpdatedAgoProps = {
	className?: string
	refreshing?: boolean
	/** Wall-clock milliseconds of the last successful read; before the first one an empty placeholder holds the line. */
	updatedAt: number | undefined
}

/**
 * Shows how old the visible data is ('Updated 12s ago') and marks an in-place refresh with a pulsing dot, so the
 * last data stays readable while the next block's read is in flight. Data that has missed several block refreshes
 * reads as stale in words and with a warning dot. The label is not a live region: it changes every second and would
 * otherwise flood assistive technology.
 */
export function UpdatedAgo({ className = '', refreshing = false, updatedAt }: UpdatedAgoProps) {
	const visible = usePageVisible()
	const [tick, setTick] = useState(0)
	const now = Date.now()
	useEffect(() => {
		if (updatedAt === undefined || !visible) return
		// The label reads the clock on every render; the timer only schedules the next render, and pauses in a hidden tab.
		const timer = setTimeout(() => setTick(current => current + 1), updatedAgoTickMilliseconds(updatedAt, Date.now()))
		return () => clearTimeout(timer)
	}, [tick, updatedAt, visible])
	// Reserving the line before the first read keeps the content below from moving when the label appears.
	if (updatedAt === undefined) return <span className={`freshness-indicator ${className}`.trim()} data-state='pending' aria-hidden='true' />
	const label = formatUpdatedAgo(updatedAt, Math.max(now, updatedAt))
	const stale = !refreshing && isUpdatedAgoStale(updatedAt, now)
	const readAt = formatTimestamp(BigInt(Math.floor(updatedAt / 1000)))
	let state = 'idle'
	if (refreshing) state = 'refreshing'
	else if (stale) state = 'stale'
	return (
		<span className={`freshness-indicator ${className}`.trim()} data-state={state} aria-busy={refreshing} title={stale ? commonCopy.formatLastReadAtTitle(readAt) : commonCopy.formatUpdatedAtTitle(readAt)}>
			<span className='freshness-indicator-dot' aria-hidden='true' />
			<span>{stale ? commonCopy.formatStaleUpdatedLabel(label) : label}</span>
			{refreshing ? <span className='visually-hidden'>{commonCopy.refreshingData}</span> : undefined}
		</span>
	)
}
