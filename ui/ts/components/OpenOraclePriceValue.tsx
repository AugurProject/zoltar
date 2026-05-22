import { useChainTimestamp } from '../lib/chainTimestamp.js'
import { getOracleLastPriceDisplay, getOraclePriceValidityPresentation } from '../lib/securityPoolWorkflow.js'
import { getCurrentTimestamp } from '../lib/time.js'

type OpenOraclePriceValueProps = {
	currentTimestamp?: bigint
	lastPrice: bigint | undefined
	lastSettlementTimestamp: bigint
	priceValidUntilTimestamp: bigint | undefined
}

export function OpenOraclePriceValue({ currentTimestamp, lastPrice, lastSettlementTimestamp, priceValidUntilTimestamp }: OpenOraclePriceValueProps) {
	if (lastPrice === undefined || lastSettlementTimestamp === 0n) return 'Unavailable'
	const chainCurrentTimestamp = useChainTimestamp()
	const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp ?? getCurrentTimestamp()

	const validityPresentation = getOraclePriceValidityPresentation({
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
