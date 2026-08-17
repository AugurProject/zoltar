import * as commonCopy from '../copy/common.js'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { MetricField } from './MetricField.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

type AddressInfoProps = {
	address: Address | undefined
	label: string
	unavailableLabel?: string
}

export function AddressInfo({ address, label, unavailableLabel = commonCopy.unknown }: AddressInfoProps) {
	const fallbackLabel = unavailableLabel === commonCopy.unknown ? getMetricPlaceholderPresentation(address)?.placeholder : unavailableLabel
	return <MetricField label={label}>{address === undefined ? fallbackLabel : <AddressValue address={address} />}</MetricField>
}
