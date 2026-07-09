import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { MetricField } from './MetricField.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type AddressInfoProps = {
	address: Address | undefined
	label: string
	unavailableLabel?: string
}

export function AddressInfo({ address, label, unavailableLabel = TSX_STRINGS.componentsAddressInfo.copy001 }: AddressInfoProps) {
	const fallbackLabel = unavailableLabel === 'Unknown' ? getMetricPlaceholderPresentation(address)?.placeholder : unavailableLabel
	return <MetricField label={label}>{address === undefined ? fallbackLabel : <AddressValue address={address} />}</MetricField>
}
