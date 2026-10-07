import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { useEffect, useId, useState } from 'preact/hooks'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CopyErrorMessage } from '@zoltar/ui-core-shared/components/CopyErrorMessage.js'
import { useCopyToClipboard } from '@zoltar/ui-core-shared/hooks/useCopyToClipboard.js'
import { isHexAddressInput, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'

/** `describedBy` names the visible reason when the address keeps the button disabled. */
function RefreshPoolButton({ address, describedBy, loading, onLoad, poolLoaded }: { address: string; describedBy?: string | undefined; loading: boolean; onLoad: (address?: string) => void; poolLoaded: boolean }) {
	const disabled = loading || !isHexAddressInput(address)
	return (
		<button className='secondary' type='button' aria-describedby={disabled ? describedBy : undefined} disabled={disabled} onClick={() => onLoad()}>
			{loading && poolLoaded ? <LoadingText>{securityPoolCopy.refreshingPool}</LoadingText> : securityPoolCopy.refreshPool}
		</button>
	)
}

/** A loaded pool's own address: read-only and truncating, with explicit copy and refresh actions beside it. */
function PoolAddressDisplay({ address, loading, onLoad }: { address: string; loading: boolean; onLoad: (address?: string) => void }) {
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(address)
	return (
		<div className='pool-selection-control pool-address-display'>
			<span className='metric-label'>{commonCopy.securityPoolAddress}</span>
			<div className='pool-address-display-row'>
				<ReadOnlyAddressValue address={address} className='pool-address-display-value' />
				<div className='pool-address-display-actions'>
					<button className='secondary' type='button' aria-label={commonCopy.formatCopyAddressValue(address)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(address)}>
						{copied.value ? commonCopy.copied : workspaceCopy.copyPoolAddress}
					</button>
					<RefreshPoolButton address={address} loading={loading} onLoad={onLoad} poolLoaded />
				</div>
			</div>
			{copied.value ? <UserMessage placement='field' as='span' className='visually-hidden' announcement='polite' detail={commonCopy.copiedAddress} /> : undefined}
			<CopyErrorMessage id={copyErrorId} manualValue={address} message={copyError.value} />
		</div>
	)
}

/**
 * The pool page's address. A loaded pool shows its address read-only; otherwise partial input stays local so the pool URL only changes
 * once a complete address is entered. `poolLoaded` keeps the busy label on the action only when a shown pool is being refreshed.
 */
export function PoolSelectionControl({ address, loading, onAddressChange, onLoad, poolLoaded }: { address: string; loading: boolean; onAddressChange: (address: string) => void; onLoad: (address?: string) => void; poolLoaded: boolean }) {
	const [draft, setDraft] = useState(address)
	const reasonId = useId()
	useEffect(() => setDraft(address), [address])
	if (poolLoaded) return <PoolAddressDisplay address={address} loading={loading} onLoad={onLoad} />
	const trimmedAddress = address.trim()
	// A malformed address from a link is never looked up, so the field says why at once; the same text explains the disabled refresh.
	const addressError = trimmedAddress !== '' && !isHexAddressInput(trimmedAddress) ? securityPoolCopy.invalidPoolAddressError : undefined
	const emptyAddressReason = trimmedAddress === '' ? securityPoolCopy.poolAddressRequired : undefined
	return (
		<div className='pool-selection-control'>
			<LookupFieldRow
				error={addressError}
				errorId={reasonId}
				label={commonCopy.securityPoolAddress}
				value={draft}
				onInput={value => {
					const trimmed = value.trim()
					setDraft(trimmed)
					if (isHexAddressInput(trimmed) && !sameAddress(trimmed, address)) onAddressChange(trimmed)
				}}
				placeholder={commonCopy.hexValuePlaceholder}
				action={<RefreshPoolButton address={address} describedBy={addressError === undefined && emptyAddressReason === undefined ? undefined : reasonId} loading={loading} onLoad={onLoad} poolLoaded={false} />}
			/>
			{emptyAddressReason === undefined ? undefined : <UserMessage placement='field' id={reasonId} detail={emptyAddressReason} />}
		</div>
	)
}
