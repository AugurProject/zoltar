import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'
import { MetricField } from './MetricField.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

type AddressInfoProps = {
	address: Address | undefined
	label: string
	unavailableLabel?: string
}

export function AddressInfo({ address, label, unavailableLabel = 'Unknown' }: AddressInfoProps) {
	const fallbackLabel = unavailableLabel === 'Unknown' ? getMetricPlaceholderPresentation(address)?.placeholder : unavailableLabel
	return <MetricField label={label}>{address === undefined ? fallbackLabel : <AddressValue address={address} />}</MetricField>
}
