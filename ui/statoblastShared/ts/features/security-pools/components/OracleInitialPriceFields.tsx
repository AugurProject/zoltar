import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

export type OracleInitialPriceInput = { source: 'automatic' | 'manual'; price: string }

export function parseOracleInitialPrice(input: OracleInitialPriceInput) {
	const proposedRepPerEthPrice = input.source === 'manual' ? tryParseDecimalInput(input.price) : undefined
	const error = input.source === 'manual' && (proposedRepPerEthPrice === undefined || proposedRepPerEthPrice <= 0n || proposedRepPerEthPrice >= 2n ** 256n) ? securityPoolCopy.manualInitialPriceError : undefined
	return { proposedRepPerEthPrice, error }
}

export function OracleInitialPriceFields({ value, onChange, disabled, fieldId }: { value: OracleInitialPriceInput; onChange: (value: OracleInitialPriceInput) => void; disabled: boolean; fieldId: string }) {
	return (
		<>
			<ViewTabs
				ariaLabel={securityPoolCopy.initialPriceSource}
				variant='segmented'
				size='compact'
				value={value.source}
				onChange={source => onChange({ ...value, source })}
				options={[
					{ id: `${fieldId}-automatic`, value: 'automatic', label: securityPoolCopy.automaticUniswapPrice, disabled },
					{ id: `${fieldId}-manual`, value: 'manual', label: securityPoolCopy.manualInitialPrice, disabled },
				]}
			/>
			{value.source === 'manual' ? (
				<label className='field' id={fieldId}>
					<span>{securityPoolCopy.manualRepPerEth}</span>
					<FormInput aria-label={securityPoolCopy.manualRepPerEth} value={value.price} inputMode='decimal' disabled={disabled} onInput={event => onChange({ ...value, price: event.currentTarget.value })} error={parseOracleInitialPrice(value).error} hint={securityPoolCopy.manualInitialPriceHint} />
				</label>
			) : undefined}
		</>
	)
}
