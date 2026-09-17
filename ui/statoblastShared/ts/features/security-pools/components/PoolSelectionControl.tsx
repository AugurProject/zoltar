import { useEffect, useState } from 'preact/hooks'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as copy from '../../../copy/poolWorkspace.js'

export function PoolSelectionControl({ address, hasPool, loading, onAddressChange, onLoad }: { address: string; hasPool: boolean; loading: boolean; onAddressChange: (address: string) => void; onLoad: (address?: string) => void }) {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(address)
	useEffect(() => {
		setDraft(address)
		setEditing(false)
	}, [address])
	return (
		<div className='pool-selection-control'>
			{hasPool ? (
				<div className='pool-selection-toolbar'>
					<div className='actions'>
						<button className='quiet' type='button' aria-expanded={editing} onClick={() => setEditing(value => !value)}>
							{copy.changePool}
						</button>
						<button className='quiet' type='button' disabled={loading} onClick={() => onLoad()}>
							{loading ? <LoadingText>{securityPoolCopy.refreshingPool}</LoadingText> : securityPoolCopy.refreshPool}
						</button>
					</div>
				</div>
			) : undefined}
			{!hasPool || editing ? (
				<LookupFieldRow
					label={commonCopy.securityPoolAddress}
					value={draft}
					onInput={setDraft}
					placeholder={commonCopy.hexValuePlaceholder}
					action={
						<button
							className='secondary'
							type='button'
							disabled={draft.trim() === '' || loading}
							onClick={() => {
								onAddressChange(draft.trim())
								onLoad(draft.trim())
								setEditing(false)
							}}
						>
							{loading ? <LoadingText>{securityPoolCopy.refreshingPool}</LoadingText> : securityPoolCopy.openPool}
						</button>
					}
				/>
			) : undefined}
		</div>
	)
}
