import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { MetricField } from './MetricField.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { UI_STRING_UNKNOWN } from '../lib/uiStrings.js'

type AddressInfoProps = {
	address: Address | undefined
	label: string
	unavailableLabel?: string
}

export function AddressInfo({ address, label, unavailableLabel = UI_STRING_UNKNOWN }: AddressInfoProps) {
	const fallbackLabel = unavailableLabel === UI_STRING_UNKNOWN ? getMetricPlaceholderPresentation(address)?.placeholder : unavailableLabel
	return <MetricField label={label}>{address === undefined ? fallbackLabel : <AddressValue address={address} />}</MetricField>
}
