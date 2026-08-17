import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import { getOracleLastPriceDisplay, getOraclePriceValidityPresentation } from '../lib/openOracle.js'

type OpenOraclePriceValueProps = {
	currentTimestamp?: bigint | undefined
	lastPrice: bigint | undefined
	lastSettlementTimestamp: bigint
	priceValidUntilTimestamp: bigint | undefined
}

export function OpenOraclePriceValue({ currentTimestamp, lastPrice, lastSettlementTimestamp, priceValidUntilTimestamp }: OpenOraclePriceValueProps) {
	if (lastPrice === undefined || lastSettlementTimestamp === 0n) return commonCopy.unavailable
	const chainCurrentTimestamp = useChainTimestamp()
	const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp

	const validityPresentation =
		resolvedCurrentTimestamp === undefined
			? undefined
			: getOraclePriceValidityPresentation({
					currentTimestamp: resolvedCurrentTimestamp,
					lastSettlementTimestamp,
					priceValidUntilTimestamp,
				})

	return (
		<span className='oracle-price-value'>
			<span>{getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp })}</span>
			{validityPresentation === undefined ? null : <span className={`oracle-price-validity ${validityPresentation.tone}`}>{validityPresentation.text}</span>}
		</span>
	)
}
