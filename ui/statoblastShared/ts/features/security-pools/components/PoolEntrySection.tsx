import { useState } from 'preact/hooks'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'

export function PoolEntrySection({ onBrowsePools, onCreatePool, onOpenPool }: { onBrowsePools: () => void; onCreatePool: () => void; onOpenPool: (address: string) => void }) {
	const [address, setAddress] = useState('')
	const [submitted, setSubmitted] = useState(false)
	const validAddress = isHexAddressInput(address.trim())
	return (
		<SectionBlock className='pool-entry-primary' variant='surface'>
			<p className='detail'>{workspaceCopy.openPoolDescription}</p>
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
			<div className='pool-entry-links'>
				<button className='link' type='button' onClick={onBrowsePools}>
					{commonCopy.browsePools}
				</button>
				<button className='link' type='button' onClick={onCreatePool}>
					{commonCopy.createPool}
				</button>
			</div>
		</SectionBlock>
	)
}
