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
	if (!responsiveAbbreviation) return <>{address}</>
	return (
		<>
			<span className='address-value-full'>{address}</span>
			<span aria-hidden='true' className='address-value-abbreviated'>
				{compactAbbreviation ? abbreviateAddress(address, 6, 4) : abbreviateAddress(address)}
			</span>
		</>
	)
}

export function ReadOnlyAddressValue({ address, className = '', compactAbbreviation = false, responsiveAbbreviation = false }: Omit<AddressValueProps, 'copyable'>) {
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

export function AddressValue({ address, className = '', compactAbbreviation = false, copyable = true, responsiveAbbreviation = false }: AddressValueProps) {
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
