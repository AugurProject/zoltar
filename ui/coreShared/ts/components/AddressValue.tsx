import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { abbreviateAddress } from '../lib/address.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'

type AddressValueProps = {
	address: string | undefined
	className?: string
	compactAbbreviation?: boolean
	copyable?: boolean
	responsiveAbbreviation?: boolean
}

function AddressText({ address, compactAbbreviation, responsiveAbbreviation }: { address: string; compactAbbreviation: boolean; responsiveAbbreviation: boolean }) {
	const container = useRef<HTMLSpanElement>(null)
	const full = useRef<HTMLSpanElement>(null)
	const [abbreviated, setAbbreviated] = useState(false)
	useLayoutEffect(() => {
		const element = container.current
		const fullText = full.current
		if (element === null || fullText === null) return
		const measure = () => setAbbreviated(fullText.scrollWidth > element.clientWidth)
		measure()
		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(measure)
		observer.observe(element)
		observer.observe(fullText)
		return () => observer.disconnect()
	}, [address, responsiveAbbreviation])
	if (!responsiveAbbreviation) return <>{address}</>
	return (
		<span className='address-value-text' data-abbreviated={abbreviated} ref={container}>
			<span className='address-value-full' ref={full}>
				{address}
			</span>
			<span aria-hidden='true' className='address-value-abbreviated'>
				{compactAbbreviation ? abbreviateAddress(address, 6, 4) : abbreviateAddress(address)}
			</span>
		</span>
	)
}

export function ReadOnlyAddressValue({ address, className = '', compactAbbreviation = false, responsiveAbbreviation = true }: Omit<AddressValueProps, 'copyable'>) {
	if (address === undefined) {
		const placeholder = getMetricPlaceholderPresentation(address)?.placeholder
		return (
			<span className={`address-value ${className}`} title={placeholder}>
				{placeholder}
			</span>
		)
	}
	return (
		<span className={`address-value ${className}`} title={address}>
			<AddressText address={address} compactAbbreviation={compactAbbreviation} responsiveAbbreviation={responsiveAbbreviation} />
		</span>
	)
}

export function AddressValue({ address, className = '', compactAbbreviation = false, copyable = true, responsiveAbbreviation = true }: AddressValueProps) {
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(address)

	if (address === undefined || !copyable) return <ReadOnlyAddressValue address={address} className={className} compactAbbreviation={compactAbbreviation} responsiveAbbreviation={responsiveAbbreviation} />

	return (
		<span className='copy-value-wrap'>
			<button type='button' className={`address-value copyable ${className}`} title={address} aria-label={commonCopy.formatCopyAddressValue(address)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(address)}>
				{copied.value ? (
					<span className='copy-feedback' role='status'>
						{commonCopy.copiedAddress}
					</span>
				) : (
					<AddressText address={address} compactAbbreviation={compactAbbreviation} responsiveAbbreviation={responsiveAbbreviation} />
				)}
			</button>
			<CopyErrorMessage id={copyErrorId} manualValue={address} message={copyError.value} />
		</span>
	)
}
