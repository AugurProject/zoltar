import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { formatRelativeTimestamp, formatTimestamp } from '../lib/formatters.js'

type TimestampValueProps = {
	className?: string
	currentTimestamp?: bigint
	loading?: boolean
	timestamp: bigint | undefined
	undefinedText?: ComponentChildren
	zeroText?: ComponentChildren
}

function getCurrentTimestamp() {
	return BigInt(Math.floor(Date.now() / 1000))
}

export function TimestampValue({ className = '', currentTimestamp, loading = false, timestamp, undefinedText = 'Unavailable', zeroText }: TimestampValueProps) {
	const [now, setNow] = useState(() => currentTimestamp ?? getCurrentTimestamp())

	useEffect(() => {
		if (loading) return
		const updateNow = () => {
			setNow(currentTimestamp ?? getCurrentTimestamp())
		}

		updateNow()
		const intervalId = window.setInterval(updateNow, 1000)

		return () => {
			window.clearInterval(intervalId)
		}
	}, [currentTimestamp, loading])

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
