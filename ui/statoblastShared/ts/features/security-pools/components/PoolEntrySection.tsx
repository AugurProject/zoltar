import { useState } from 'preact/hooks'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

export function PoolEntrySection({ onOpenPool }: { onOpenPool: (address: string) => void }) {
	const [address, setAddress] = useState('')
	const [submitted, setSubmitted] = useState(false)
	const validAddress = isHexAddressInput(address.trim())
	return (
		<form
			onSubmit={event => {
				event.preventDefault()
				setSubmitted(true)
				if (validAddress) onOpenPool(address.trim())
			}}
		>
			<LookupFieldRow
				label={commonCopy.securityPoolAddress}
				value={address}
				onInput={setAddress}
				placeholder={commonCopy.hexValuePlaceholder}
				error={submitted && !validAddress ? securityPoolCopy.invalidPoolAddress : undefined}
				action={
					<button className='primary' type='submit'>
						{securityPoolCopy.openPool}
					</button>
				}
			/>
		</form>
	)
}
