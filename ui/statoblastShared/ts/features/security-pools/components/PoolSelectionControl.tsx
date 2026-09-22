import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

export function PoolSelectionControl({ address, loading, onAddressChange, onLoad }: { address: string; loading: boolean; onAddressChange: (address: string) => void; onLoad: (address?: string) => void }) {
	return (
		<div className='pool-selection-control'>
			<LookupFieldRow
				label={commonCopy.securityPoolAddress}
				value={address}
				onInput={value => onAddressChange(value.trim())}
				placeholder={commonCopy.hexValuePlaceholder}
				action={
					<button className='quiet' type='button' disabled={loading || !/^0x[0-9a-fA-F]{40}$/.test(address)} onClick={() => onLoad()}>
						{loading ? <LoadingText>{securityPoolCopy.refreshingPool}</LoadingText> : securityPoolCopy.refreshPool}
					</button>
				}
			/>
		</div>
	)
}
