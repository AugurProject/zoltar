import type { OraclePriceQueryStage } from '../../../protocol/openOraclePricing.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { InitialPriceWarning } from './InitialPriceWarning.js'
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
	referencePrice,
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
	/** Last known REP per ETH price; a typed price far from it, or inverted, shows a warning. */
	referencePrice?: bigint | undefined
}) {
	const progressLabel = queryStage === undefined ? priceRequestCopy.fetchingUniswapPrice : progressLabels[queryStage]
	return (
		<div className='initial-price-input'>
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
			<InitialPriceWarning price={error === undefined ? tryParseDecimalInput(value) : undefined} referencePrice={referencePrice} />
		</div>
	)
}
