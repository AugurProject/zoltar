import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import * as poolCopy from '../../../copy/securityPool.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'

export function OpenOraclePriceInput({ value, onInput, onFetch, fetching, disabled, error, errorId, fetchDisabled = false }: { value: string; onInput: (value: string) => void; onFetch: () => void; fetching: boolean; disabled: boolean; error: string | undefined; errorId?: string | undefined; fetchDisabled?: boolean }) {
	return (
		<LookupFieldRow
			label={poolCopy.manualRepPerEth}
			value={value}
			inputMode='decimal'
			disabled={disabled}
			onInput={onInput}
			error={error}
			errorId={errorId}
			action={
				<button className='secondary request-price-fetch' type='button' disabled={disabled || fetching || fetchDisabled} onClick={onFetch}>
					{fetching ? <LoadingText>{priceRequestCopy.fetchingUniswapPrice}</LoadingText> : priceRequestCopy.fetchUniswapPrice}
				</button>
			}
		/>
	)
}
