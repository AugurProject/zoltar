import type { RefObject } from 'preact'
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { abbreviateAddress, isHexAddressInput } from '../lib/address.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { buildAddressExplorerUrl, getRuntimeNetworkProfile, type NetworkProfile } from '../wallet/networkProfile.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'
import { CopyGlyph, CopyStatus } from './CopyStatus.js'

export type AddressWidthConstraint = {
	/** A stable allocation that does not shrink when the displayed address shortens. */
	slot: RefObject<HTMLElement>
	/** Includes the address and its surrounding icons, spacing and padding. */
	control: RefObject<HTMLElement>
}

type AddressValueProps = {
	address: string | undefined
	/** Always shows the short form, for compact rows where the full address would only push the copy icon away; the full address stays in the title, the copy label, and visually hidden text. */
	abbreviated?: boolean
	className?: string
	compactAbbreviation?: boolean
	explorerProfile?: NetworkProfile | undefined
	/** Keep the entire address visible, wrapping across lines when necessary. */
	wrap?: boolean
	widthConstraint?: AddressWidthConstraint | undefined
}

function AddressText({ alwaysAbbreviated, address, compactAbbreviation, widthConstraint, wrap = false }: { alwaysAbbreviated: boolean; address: string; compactAbbreviation: boolean; widthConstraint?: AddressWidthConstraint | undefined; wrap?: boolean }) {
	const container = useRef<HTMLSpanElement>(null)
	const full = useRef<HTMLSpanElement>(null)
	const [overflowing, setOverflowing] = useState(false)
	useLayoutEffect(() => {
		const element = container.current
		const fullText = full.current
		if (element === null || fullText === null || wrap) return
		const measure = () => {
			const slot = widthConstraint?.slot.current
			const control = widthConstraint?.control.current
			const availableWidth = slot && control ? slot.clientWidth - (control.offsetWidth - element.clientWidth) : element.clientWidth
			setOverflowing(fullText.scrollWidth > availableWidth)
		}
		measure()
		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(measure)
		observer.observe(element)
		observer.observe(fullText)
		if (widthConstraint?.slot.current) observer.observe(widthConstraint.slot.current)
		if (widthConstraint?.control.current) observer.observe(widthConstraint.control.current)
		return () => observer.disconnect()
	}, [address, alwaysAbbreviated, widthConstraint, wrap])
	const shortForm = compactAbbreviation ? abbreviateAddress(address, 6, 4) : abbreviateAddress(address)
	if (wrap) return <span className='address-value-wrapped'>{address}</span>
	// The short form is what sighted users read; the full address stays in the text for assistive technology and text search.
	if (alwaysAbbreviated)
		return (
			<>
				<span className='visually-hidden'>{address}</span>
				<span aria-hidden='true'>{shortForm}</span>
			</>
		)
	return (
		<span className={`address-value-text${widthConstraint === undefined ? '' : ' address-value-fit-content'}`} data-abbreviated={overflowing} ref={container}>
			<span className='address-value-full' ref={full}>
				{address}
			</span>
			<span aria-hidden='true' className='address-value-abbreviated'>
				{shortForm}
			</span>
		</span>
	)
}

export function AddressValue({ abbreviated = false, address, className = '', compactAbbreviation = false, explorerProfile, widthConstraint, wrap = false }: AddressValueProps) {
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(address)

	if (address === undefined) {
		const placeholder = getMetricPlaceholderPresentation(address)?.placeholder
		return (
			<span className={`address-value ${className}`} title={placeholder}>
				{placeholder}
			</span>
		)
	}
	const validAddress = isHexAddressInput(address)
	const href = validAddress ? buildAddressExplorerUrl(explorerProfile ?? getRuntimeNetworkProfile(), address) : undefined
	const text = <AddressText alwaysAbbreviated={abbreviated} address={address} compactAbbreviation={compactAbbreviation} widthConstraint={widthConstraint} wrap={wrap} />
	const unavailableReason = validAddress ? commonCopy.addressExplorerUnavailable : commonCopy.addressExplorerInvalid

	return (
		<span className='copy-value-wrap address-copy-control'>
			<span className={`address-control${wrap ? ' address-control-wrap' : ''}`}>
				{href === undefined ? (
					<span role='link' aria-disabled='true' aria-label={commonCopy.formatLabelValue(address, unavailableReason)} className={`address-value address-value-unavailable ${className}`} title={unavailableReason}>
						{text}
					</span>
				) : (
					<a className={`address-value address-value-link ${className}`} href={href} target='_blank' rel='noopener noreferrer' title={address} aria-label={transactionCopy.formatViewAddressOnExplorer(address)}>
						{text}
					</a>
				)}
				{/* Copy stays available inside disabled transaction fieldsets, which also disable native buttons. */}
				<span
					role='button'
					tabIndex={0}
					className='address-copy-button'
					data-copied={copied.value}
					title={address}
					aria-label={commonCopy.formatCopyAddressValue(address)}
					aria-describedby={copyError.value === undefined ? undefined : copyErrorId}
					onClick={() => copyText(address)}
					onKeyDown={event => {
						if (event.key === ' ') event.preventDefault()
						if (event.key !== 'Enter') return
						event.preventDefault()
						if (!event.repeat) void copyText(address)
					}}
					onKeyUp={event => {
						if (event.key !== ' ') return
						event.preventDefault()
						void copyText(address)
					}}
				>
					<CopyGlyph />
				</span>
			</span>
			<CopyStatus copied={copied.value} message={commonCopy.copiedAddress} />
			<CopyErrorMessage id={copyErrorId} manualValue={address} message={copyError.value} />
		</span>
	)
}

/**
 * An address that shortens only when it cannot fit `slot`, a stable allocation that does not shrink with the address. The
 * control fits its content, so a copy glyph stays right after the visible text.
 */
export function FittedAddressValue({ address, className = '', slot }: { address: string; className?: string; slot: RefObject<HTMLElement> }) {
	const control = useRef<HTMLSpanElement>(null)
	const widthConstraint = useMemo(() => ({ control, slot }), [slot])
	return (
		<span className={`address-fit-control ${className}`.trim()} ref={control}>
			<AddressValue address={address} widthConstraint={widthConstraint} />
		</span>
	)
}
