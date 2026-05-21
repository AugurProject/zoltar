import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useChainTimestamp } from '../lib/chainTimestamp.js'
import { formatRelativeTimestamp, formatTimestamp } from '../lib/formatters.js'
import { getCurrentTimestamp } from '../lib/time.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

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
	const [fallbackNow, setFallbackNow] = useState(() => getCurrentTimestamp())
	const now = resolvedCurrentTimestamp ?? fallbackNow

	useEffect(() => {
		if (loading || resolvedCurrentTimestamp !== undefined) return
		setFallbackNow(getCurrentTimestamp())
		const intervalId = window.setInterval(() => {
			setFallbackNow(getCurrentTimestamp())
		}, 1000)

		return () => {
			window.clearInterval(intervalId)
		}
	}, [loading, resolvedCurrentTimestamp])

	if (loading) {
		return <span className={`timestamp-value loading ${className}`}>Loading...</span>
	}

	if (timestamp === undefined) {
		return <span className={`timestamp-value unavailable ${className}`}>{undefinedText}</span>
	}

	if (timestamp === 0n) {
		return (
			<span className={`timestamp-value zero ${className}`} title={typeof zeroText === 'string' ? zeroText : undefined}>
				{zeroText ?? formatTimestamp(timestamp)}
			</span>
		)
	}

	const absoluteTimestamp = formatTimestamp(timestamp)
	const relativeTimestamp = formatRelativeTimestamp(timestamp, now)

	return (
		<time className={`timestamp-value ${className}`} dateTime={new Date(Number(timestamp) * 1000).toISOString()} title={absoluteTimestamp}>
			{absoluteTimestamp} <span className='timestamp-value-relative'>({relativeTimestamp})</span>
		</time>
	)
}
