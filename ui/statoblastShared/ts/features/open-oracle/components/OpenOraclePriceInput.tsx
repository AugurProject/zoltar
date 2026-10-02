import type { OraclePriceQueryStage } from '../../../protocol/openOraclePricing.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import * as poolCopy from '../../../copy/securityPool.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'

const progressLabels: Record<OraclePriceQueryStage, string> = {
	oracle: priceRequestCopy.readingPriceOracle,
	v4: priceRequestCopy.queryingUniswapV4,
	v3: priceRequestCopy.queryingUniswapV3,
}

export function OpenOraclePriceInput({
	value,
	onInput,
	onFetch,
	fetching,
	disabled,
	error,
	errorId,
	fetchDisabled = false,
	queryStage,
}: {
	value: string
	onInput: (value: string) => void
	onFetch: () => void
	fetching: boolean
	disabled: boolean
	error: string | undefined
	errorId?: string | undefined
	fetchDisabled?: boolean
	queryStage?: OraclePriceQueryStage | undefined
}) {
	const progressLabel = queryStage === undefined ? priceRequestCopy.fetchingUniswapPrice : progressLabels[queryStage]
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
				<button className='secondary request-price-fetch' type='button' disabled={disabled || fetching || fetchDisabled} onClick={onFetch} aria-busy={fetching}>
					{fetching ? <LoadingText>{progressLabel}</LoadingText> : priceRequestCopy.fetchUniswapPrice}
				</button>
			}
		/>
	)
}
