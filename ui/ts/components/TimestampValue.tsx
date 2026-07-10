import type { ComponentChildren } from 'preact'
import { useChainTimestamp } from '../lib/chainTimestamp.js'
import { formatRelativeTimestamp, formatTimestamp } from '../lib/formatters.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { UI_STRING_LOADING_WITH_ELLIPSIS } from '../lib/uiStrings.js'

type TimestampValueProps = {
	className?: string
	currentTimestamp?: bigint
	loading?: boolean
	timestamp: bigint | undefined
	undefinedText?: ComponentChildren
	zeroText?: ComponentChildren
}

export function TimestampValue({ className = '', currentTimestamp, loading = false, timestamp, undefinedText = getMetricPlaceholderPresentation(undefined)?.placeholder, zeroText }: TimestampValueProps) {
	const chainCurrentTimestamp = useChainTimestamp()
	const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp

	if (loading) return <span className={`timestamp-value loading ${className}`}>{UI_STRING_LOADING_WITH_ELLIPSIS}</span>

	if (timestamp === undefined) return <span className={`timestamp-value unavailable ${className}`}>{undefinedText}</span>

	if (timestamp === 0n)
		return (
			<span className={`timestamp-value zero ${className}`} title={typeof zeroText === 'string' ? zeroText : undefined}>
				{zeroText ?? formatTimestamp(timestamp)}
			</span>
		)

	const absoluteTimestamp = formatTimestamp(timestamp)
	const relativeTimestamp = resolvedCurrentTimestamp === undefined ? undefined : formatRelativeTimestamp(timestamp, resolvedCurrentTimestamp)

	return (
		<time className={`timestamp-value ${className}`} dateTime={new Date(Number(timestamp) * 1000).toISOString()} title={absoluteTimestamp}>
			{absoluteTimestamp}
			{relativeTimestamp === undefined ? null : (
				<>
					{' '}
					<span className='timestamp-value-relative'>({relativeTimestamp})</span>
				</>
			)}
		</time>
	)
}
