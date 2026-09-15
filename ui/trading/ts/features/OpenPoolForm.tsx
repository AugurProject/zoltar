import { useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { getTradingRouteHref, type TradingLookupRoute } from '../lib/routing.js'
import { liveCopy } from '../copy/live.js'

/** Address lookup for a workflow: submitting opens the addressed route for the target workflow. */
export function OpenPoolForm({ disabled, target = 'market' }: { disabled: boolean; target?: TradingLookupRoute }) {
	const [address, setAddress] = useState('')
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
			<LookupFieldRow
				label={liveCopy.openPoolAddress}
				value={address}
				disabled={disabled}
				error={invalid ? liveCopy.invalidPoolAddress : undefined}
				placeholder={liveCopy.poolAddressPlaceholder}
				onInput={setAddress}
				action={
					<button class='primary' type='submit' disabled={disabled || !valid}>
						{liveCopy.openPool}
					</button>
				}
			/>
		</form>
	)
}
