import * as commonCopy from '../copy/common.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

type AddressValueProps = {
	address: string | undefined
	className?: string
}

export function AddressValue({ address, className = '' }: AddressValueProps) {
	const { copied, copyText } = useCopyToClipboard()

	if (address === undefined) {
		const placeholder = getMetricPlaceholderPresentation(address)?.placeholder
		return (
			<span className={`address-value ${className}`} title={placeholder}>
				{placeholder}
			</span>
		)
	}

	return (
		<button type='button' className={`address-value copyable ${className}`} title={address} aria-label={commonCopy.formatCopyAddressValue(address)} onClick={() => copyText(address)}>
			{copied.value ? commonCopy.copied : address}
		</button>
	)
}
