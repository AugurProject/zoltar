import { useId, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { getTradingRouteHref, type TradingLookupRoute } from '../lib/routing.js'
import { liveCopy } from '../copy/live.js'

export function OpenPoolForm({ disabled, target = 'market' }: { disabled: boolean; target?: TradingLookupRoute }) {
	const [address, setAddress] = useState('')
	const id = useId()
	const parsed = tryParseAddressInput(address.trim())
	const valid = parsed !== undefined && parsed !== zeroAddress
	const invalid = address.trim() !== '' && !valid
	return (
		<form
			class='open-pool-form'
			onSubmit={event => {
				event.preventDefault()
				if (disabled || !valid) return
				window.location.hash = getTradingRouteHref(`#/${target}/${parsed}`)
			}}
		>
			<label class='field' for={id}>
				<span>{liveCopy.openPoolAddress}</span>
				<FormInput id={id} value={address} disabled={disabled} invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} placeholder={liveCopy.poolAddressPlaceholder} onInput={event => setAddress(event.currentTarget.value)} />
			</label>
			{invalid ? (
				<p id={`${id}-error`} role='status'>
					{liveCopy.invalidPoolAddress}
				</p>
			) : null}
			<button class='primary-action' type='submit' disabled={disabled || !valid}>
				{liveCopy.openPool}
			</button>
		</form>
	)
}
