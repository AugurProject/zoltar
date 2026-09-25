import { useEffect, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { formatUpdatedAgo, updatedAgoTickMilliseconds } from '../lib/freshness.js'
import { usePageVisible } from '../hooks/useDataRefresh.js'

type UpdatedAgoProps = {
	className?: string
	refreshing?: boolean
	/** Wall-clock milliseconds of the last successful read; before the first one an empty placeholder holds the line. */
	updatedAt: number | undefined
}

/**
 * Shows how old the visible data is ('Updated 12s ago') and marks an in-place refresh with a pulsing dot, so the
 * last data stays readable while the next block's read is in flight. The label is not a live region: it changes
 * every second and would otherwise flood assistive technology.
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
	return (
		<span className={`freshness-indicator ${className}`.trim()} data-state={refreshing ? 'refreshing' : 'idle'} aria-busy={refreshing} title={commonCopy.formatUpdatedAtTitle(new Date(updatedAt).toLocaleTimeString())}>
			<span className='freshness-indicator-dot' aria-hidden='true' />
			<span>{label}</span>
			{refreshing ? <span className='visually-hidden'>{commonCopy.refreshingData}</span> : undefined}
		</span>
	)
}
