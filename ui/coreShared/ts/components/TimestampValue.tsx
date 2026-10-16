import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'
import { LoadingText } from './LoadingText.js'
import { useChainTimestamp } from '../wallet/chainTimestamp.js'
import { formatLocalTimestamp, formatRelativeTimestamp, formatTimestamp, formatTimestampDateTime, getWallClockTimestamp } from '../lib/formatters.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

type TimestampValueProps = {
	className?: string
	currentTimestamp?: bigint
	loading?: boolean
	/** Where the relative time goes: `'after'` (default) brackets it after the UTC time; `'first'` leads with it and sets the UTC time quietly beneath, for narrow columns where the full form would wrap over three lines; `false` leaves it out. */
	relative?: 'after' | 'first' | false
	timestamp: bigint | undefined
	undefinedText?: ComponentChildren
	zeroText?: ComponentChildren
}

export function TimestampValue({ className = '', currentTimestamp, loading = false, relative = 'after', timestamp, undefinedText = getMetricPlaceholderPresentation(undefined)?.placeholder, zeroText }: TimestampValueProps) {
	const chainCurrentTimestamp = useChainTimestamp()
	const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp ?? getWallClockTimestamp()

	// A section can hold many loading values, so each spinner stays silent instead of being its own live region.
	if (loading) return <LoadingText announce={false} className={`timestamp-value loading ${className}`} />

	if (timestamp === undefined) return <span className={`timestamp-value unavailable ${className}`}>{undefinedText}</span>

	if (timestamp === 0n)
		return (
			<span className={`timestamp-value zero ${className}`} title={typeof zeroText === 'string' ? zeroText : undefined}>
				{zeroText ?? formatTimestamp(timestamp)}
			</span>
		)

	const absoluteTimestamp = formatTimestamp(timestamp)
	const dateTime = formatTimestampDateTime(timestamp)
	if (dateTime === undefined)
		return (
			<span className={`timestamp-value error ${className}`} title={absoluteTimestamp}>
				{absoluteTimestamp}
			</span>
		)

	const relativeTimestamp = formatRelativeTimestamp(timestamp, resolvedCurrentTimestamp)
	// UTC stays the visible canonical value; the viewer's own time, which creation forms use, is added where it differs.
	const localTimestamp = formatLocalTimestamp(timestamp)
	const localTimeLabel = localTimestamp === undefined ? undefined : commonCopy.formatLocalTimeLabel(localTimestamp)

	const parts =
		relative === 'first' ? (
			<>
				<span className='timestamp-value-lead'>{relativeTimestamp}</span> <span className='timestamp-value-absolute'>{absoluteTimestamp}</span>
			</>
		) : (
			<>
				{absoluteTimestamp}
				{relative === 'after' ? (
					<>
						{' '}
						<span className='timestamp-value-relative'>({relativeTimestamp})</span>
					</>
				) : undefined}
			</>
		)
	return (
		<time className={`timestamp-value${relative === 'first' ? ' is-relative-first' : ''} ${className}`} dateTime={dateTime} title={localTimeLabel ?? absoluteTimestamp}>
			{parts}
			{localTimeLabel === undefined ? undefined : (
				<>
					{' '}
					<span className='visually-hidden'>{localTimeLabel}</span>
				</>
			)}
		</time>
	)
}
