import type { RefObject } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { abbreviateAddress } from '../lib/address.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'

export type AddressWidthConstraint = {
	/** A stable allocation that does not shrink when the displayed address shortens. */
	slot: RefObject<HTMLElement>
	/** Includes the address and its surrounding icons, spacing and padding. */
	control: RefObject<HTMLElement>
}

type AddressValueProps = {
	address: string | undefined
	className?: string
	compactAbbreviation?: boolean
	copyable?: boolean
	responsiveAbbreviation?: boolean
	widthConstraint?: AddressWidthConstraint | undefined
}

function AddressText({ address, compactAbbreviation, responsiveAbbreviation, widthConstraint }: { address: string; compactAbbreviation: boolean; responsiveAbbreviation: boolean; widthConstraint?: AddressWidthConstraint | undefined }) {
	const container = useRef<HTMLSpanElement>(null)
	const full = useRef<HTMLSpanElement>(null)
	const [abbreviated, setAbbreviated] = useState(false)
	useLayoutEffect(() => {
		const element = container.current
		const fullText = full.current
		if (element === null || fullText === null) return
		const measure = () => {
			const slot = widthConstraint?.slot.current
			const control = widthConstraint?.control.current
			const availableWidth = slot && control ? slot.clientWidth - (control.offsetWidth - element.clientWidth) : element.clientWidth
			setAbbreviated(fullText.scrollWidth > availableWidth)
		}
		measure()
		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(measure)
		observer.observe(element)
		observer.observe(fullText)
		if (widthConstraint?.slot.current) observer.observe(widthConstraint.slot.current)
		if (widthConstraint?.control.current) observer.observe(widthConstraint.control.current)
		return () => observer.disconnect()
	}, [address, responsiveAbbreviation, widthConstraint])
	if (!responsiveAbbreviation) return <>{address}</>
	return (
		<span className={`address-value-text${widthConstraint === undefined ? '' : ' address-value-fit-content'}`} data-abbreviated={abbreviated} ref={container}>
			<span className='address-value-full' ref={full}>
				{address}
			</span>
			<span aria-hidden='true' className='address-value-abbreviated'>
				{compactAbbreviation ? abbreviateAddress(address, 6, 4) : abbreviateAddress(address)}
			</span>
		</span>
	)
}

export function ReadOnlyAddressValue({ address, className = '', compactAbbreviation = false, responsiveAbbreviation = true, widthConstraint }: Omit<AddressValueProps, 'copyable'>) {
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
			<AddressText address={address} compactAbbreviation={compactAbbreviation} responsiveAbbreviation={responsiveAbbreviation} widthConstraint={widthConstraint} />
		</span>
	)
}

export function AddressValue({ address, className = '', compactAbbreviation = false, copyable = true, responsiveAbbreviation = true, widthConstraint }: AddressValueProps) {
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(address)

	if (address === undefined || !copyable) return <ReadOnlyAddressValue address={address} className={className} compactAbbreviation={compactAbbreviation} responsiveAbbreviation={responsiveAbbreviation} widthConstraint={widthConstraint} />

	return (
		<span className='copy-value-wrap'>
			<button type='button' className={`address-value copyable ${className}`} title={address} aria-label={commonCopy.formatCopyAddressValue(address)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(address)}>
				{copied.value ? (
					<span className='copy-feedback' role='status'>
						{commonCopy.copiedAddress}
					</span>
				) : (
					<AddressText address={address} compactAbbreviation={compactAbbreviation} responsiveAbbreviation={responsiveAbbreviation} widthConstraint={widthConstraint} />
				)}
			</button>
			<CopyErrorMessage id={copyErrorId} manualValue={address} message={copyError.value} />
		</span>
	)
}
