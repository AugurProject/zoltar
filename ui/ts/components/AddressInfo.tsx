import type { Address } from 'viem'
import { AddressValue } from './AddressValue.js'

type AddressInfoProps = {
	address: Address | undefined
	label: string
	unavailableLabel?: string
}

export function AddressInfo({ address, label, unavailableLabel = 'Unknown' }: AddressInfoProps) {
	return (
		<div>
			<span className='metric-label'>{label}</span>
			<strong>{address === undefined ? unavailableLabel : <AddressValue address={address} />}</strong>
		</div>
	)
}
