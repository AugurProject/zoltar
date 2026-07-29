import * as commonCopy from '../copy/common.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

type AddressValueProps = {
	address: string | undefined
	className?: string
	copyable?: boolean
	responsiveAbbreviation?: boolean
}

function abbreviateAddress(address: string) {
	if (address.length <= 13) return address
	return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function AddressText({ address, responsiveAbbreviation }: { address: string; responsiveAbbreviation: boolean }) {
	if (!responsiveAbbreviation) return <>{address}</>
	return (
		<>
			<span className='address-value-full'>{address}</span>
			<span aria-hidden='true' className='address-value-abbreviated'>
				{abbreviateAddress(address)}
			</span>
		</>
	)
}

export function AddressValue({ address, className = '', copyable = true, responsiveAbbreviation = false }: AddressValueProps) {
	const { copied, copyText } = useCopyToClipboard()

	if (address === undefined) {
		const placeholder = getMetricPlaceholderPresentation(address)?.placeholder
		return (
			<span className={`address-value ${className}`} title={placeholder}>
				{placeholder}
			</span>
		)
	}

	if (!copyable)
		return (
			<span className={`address-value ${className}`} title={address}>
				<AddressText address={address} responsiveAbbreviation={responsiveAbbreviation} />
			</span>
		)

	return (
		<button type='button' className={`address-value copyable ${className}`} title={address} aria-label={commonCopy.formatCopyAddressValue(address)} onClick={() => copyText(address)}>
			{copied.value ? commonCopy.copied : <AddressText address={address} responsiveAbbreviation={responsiveAbbreviation} />}
		</button>
	)
}
