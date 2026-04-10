import { useSignalEffect } from '@preact/signals'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { formatAddress } from '../lib/addresses.js'

type AddressValueProps = {
	address: string | undefined
	className?: string
}

export function AddressValue({ address, className = '' }: AddressValueProps) {
	const { copied, copyText } = useCopyToClipboard()
	const buttonRef = useRef<HTMLButtonElement>(null)
	const measureRef = useRef<HTMLSpanElement>(null)
	const [shouldShorten, setShouldShorten] = useState(false)

	useLayoutEffect(() => {
		const element = buttonRef.current
		const measureElement = measureRef.current
		if (address === undefined || element === null || measureElement === null) {
			setShouldShorten(false)
			return
		}

		const updateShortening = () => {
			if (copied.value) return
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

	useSignalEffect(() => {
		if (copied.value) return
		const element = buttonRef.current
		const measureElement = measureRef.current
		if (address === undefined || element === null || measureElement === null) return
		setShouldShorten(measureElement.getBoundingClientRect().width > element.clientWidth + 1)
	})

	if (address === undefined) {
		return (
			<span className={`address-value ${className}`} title='Unavailable'>
				Unavailable
			</span>
		)
	}

	const displayValue = shouldShorten ? formatAddress(address) : address

	return (
		<button ref={buttonRef} type='button' className={`address-value copyable ${className}`} title={address} aria-label={`Copy address ${address}`} onClick={() => copyText(address)}>
			{copied.value ? 'Copied' : displayValue}
			<span ref={measureRef} aria-hidden='true' className='address-value-measure'>
				{address}
			</span>
		</button>
	)
}
