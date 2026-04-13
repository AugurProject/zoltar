import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'
import { MetricField } from './MetricField.js'

type AddressInfoProps = {
	address: Address | undefined
	label: string
	unavailableLabel?: string
}

export function AddressInfo({ address, label, unavailableLabel = 'Unknown' }: AddressInfoProps) {
	return <MetricField label={label}>{address === undefined ? unavailableLabel : <AddressValue address={address} />}</MetricField>
}
