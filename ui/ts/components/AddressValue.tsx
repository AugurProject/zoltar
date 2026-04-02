import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { formatAddress } from '../lib/addresses.js'

type AddressValueProps = {
	address: string | undefined
	className?: string
}

export function AddressValue({ address, className = '' }: AddressValueProps) {
	const textRef = useRef<HTMLSpanElement>(null)
	const measureRef = useRef<HTMLSpanElement>(null)
	const [shouldShorten, setShouldShorten] = useState(false)

	useLayoutEffect(() => {
		const element = textRef.current
		const measureElement = measureRef.current
		if (address === undefined || element === null || measureElement === null) {
			setShouldShorten(false)
			return
		}

		const updateShortening = () => {
			setShouldShorten(measureElement.getBoundingClientRect().width > element.clientWidth + 1)
		}

		updateShortening()

		if (typeof ResizeObserver === 'undefined') return

		const observer = new ResizeObserver(() => {
			updateShortening()
		})
		observer.observe(element)

		return () => {
			observer.disconnect()
		}
	}, [address])

	return (
		<span ref={textRef} className={`address-value ${className}`} title={address ?? 'Unavailable'}>
			{shouldShorten ? formatAddress(address) : (address ?? 'Unavailable')}
			{address === undefined ? undefined : (
				<span ref={measureRef} aria-hidden='true' className='address-value-measure'>
					{address}
				</span>
			)}
		</span>
	)
}
