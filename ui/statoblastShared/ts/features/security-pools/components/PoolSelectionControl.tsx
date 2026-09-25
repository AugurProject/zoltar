import { useEffect, useState } from 'preact/hooks'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { isHexAddressInput, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

/**
 * The pool page's address field. Partial input stays local so the pool URL only changes once a complete address is entered;
 * `poolLoaded` keeps the busy label on the action only when a shown pool is being refreshed.
 */
export function PoolSelectionControl({ address, loading, onAddressChange, onLoad, poolLoaded }: { address: string; loading: boolean; onAddressChange: (address: string) => void; onLoad: (address?: string) => void; poolLoaded: boolean }) {
	const [draft, setDraft] = useState(address)
	useEffect(() => setDraft(address), [address])
	return (
		<div className='pool-selection-control'>
			<LookupFieldRow
				label={commonCopy.securityPoolAddress}
				value={draft}
				onInput={value => {
					const trimmed = value.trim()
					setDraft(trimmed)
					if (isHexAddressInput(trimmed) && !sameAddress(trimmed, address)) onAddressChange(trimmed)
				}}
				placeholder={commonCopy.hexValuePlaceholder}
				action={
					<button className='quiet' type='button' disabled={loading || !isHexAddressInput(address)} onClick={() => onLoad()}>
						{loading && poolLoaded ? <LoadingText>{securityPoolCopy.refreshingPool}</LoadingText> : securityPoolCopy.refreshPool}
					</button>
				}
			/>
		</div>
	)
}
