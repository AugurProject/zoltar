import type { OraclePriceQueryProgress, OraclePriceQueryStage } from '../../../protocol/openOraclePricing.js'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { getCoordinatorInitialReportPrice } from '../../../protocol/oracleCoordinator.js'
import { OpenOraclePriceInput } from '../../open-oracle/components/OpenOraclePriceInput.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'

export type OracleInitialPriceInput = { price: string }

export function parseOracleInitialPrice(input: OracleInitialPriceInput | undefined) {
	const proposedRepPerEthPrice = input === undefined ? undefined : tryParseDecimalInput(input.price)
	const error = input !== undefined && (proposedRepPerEthPrice === undefined || proposedRepPerEthPrice <= 0n || proposedRepPerEthPrice >= 2n ** 256n) ? securityPoolCopy.manualInitialPriceError : undefined
	return { proposedRepPerEthPrice, error }
}

async function fetchInitialPrice(managerAddress: Address, onProgress?: OraclePriceQueryProgress) {
	return await getCoordinatorInitialReportPrice(createConnectedReadClient(), managerAddress, 0n, onProgress)
}

export function OracleInitialPriceFields({
	value,
	onChange,
	disabled,
	fieldId,
	managerAddress,
	fetchPrice = fetchInitialPrice,
}: {
	value: OracleInitialPriceInput
	onChange: (value: OracleInitialPriceInput) => void
	disabled: boolean
	fieldId: string
	managerAddress: Address | undefined
	fetchPrice?: typeof fetchInitialPrice
}) {
	const [fetching, setFetching] = useState(false)
	const [queryStage, setQueryStage] = useState<OraclePriceQueryStage>()
	const [quoteError, setQuoteError] = useState<string>()
	const attempt = useRef(0)
	const previousManager = useRef(managerAddress)
	useLayoutEffect(() => {
		if (previousManager.current !== managerAddress) onChange({ price: '' })
		previousManager.current = managerAddress
		attempt.current += 1
		setFetching(false)
		setQuoteError(undefined)
		return () => {
			attempt.current += 1
		}
	}, [managerAddress])
	const fetchQuote = async () => {
		if (managerAddress === undefined || disabled || fetching) return
		const current = ++attempt.current
		setFetching(true)
		setQueryStage('oracle')
		setQuoteError(undefined)
		onChange({ price: '' })
		try {
			const price = await fetchPrice(managerAddress, stage => {
				if (current === attempt.current) setQueryStage(stage)
			})
			if (current === attempt.current) onChange({ price: formatUnits(price, 18) })
		} catch (error) {
			if (current === attempt.current) setQuoteError(getErrorMessage(error, priceRequestCopy.uniswapPriceFailed))
		} finally {
			if (current === attempt.current) setFetching(false)
		}
	}
	return (
		<div id={fieldId} className='request-price-fields'>
			<OpenOraclePriceInput
				value={value.price}
				errorId={`${fieldId}-error`}
				disabled={disabled}
				fetchDisabled={managerAddress === undefined}
				fetching={fetching}
				queryStage={queryStage}
				error={quoteError ?? (value.price === '' ? undefined : parseOracleInitialPrice(value).error)}
				onFetch={() => void fetchQuote()}
				onInput={price => {
					attempt.current += 1
					setFetching(false)
					setQuoteError(undefined)
					onChange({ price })
				}}
			/>
		</div>
	)
}
