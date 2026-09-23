import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { getOracleLastPriceDisplay, getOraclePriceValidityPresentation } from '../lib/openOracle.js'
import { useEffect, useState } from 'preact/hooks'
import { formatPendingPriceAvailability } from '../../../copy/pricing.js'

type OpenOraclePriceValueProps = {
	currentTimestamp?: bigint | undefined
	lastPrice: bigint | undefined
	lastSettlementTimestamp: bigint
	priceValidUntilTimestamp: bigint | undefined
	pendingReportReadyAtTimestamp?: bigint | undefined
}

export function OpenOraclePriceValue({ currentTimestamp, lastPrice, lastSettlementTimestamp, pendingReportReadyAtTimestamp, priceValidUntilTimestamp }: OpenOraclePriceValueProps) {
	const chainCurrentTimestamp = useChainTimestamp()
	const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp
	const [estimatedTimestamp, setEstimatedTimestamp] = useState(resolvedCurrentTimestamp ?? BigInt(Math.floor(Date.now() / 1000)))
	useEffect(() => {
		const startWallTime = Date.now()
		const startTimestamp = resolvedCurrentTimestamp ?? BigInt(Math.floor(startWallTime / 1000))
		setEstimatedTimestamp(startTimestamp)
		if (pendingReportReadyAtTimestamp === undefined) return
		const interval = setInterval(() => setEstimatedTimestamp(startTimestamp + BigInt(Math.floor((Date.now() - startWallTime) / 1000))), 1000)
		return () => clearInterval(interval)
	}, [pendingReportReadyAtTimestamp, resolvedCurrentTimestamp])
	const remaining = pendingReportReadyAtTimestamp === undefined ? undefined : pendingReportReadyAtTimestamp - estimatedTimestamp
	const hasSettledPrice = lastPrice !== undefined && lastSettlementTimestamp > 0n
	const pendingLabel = remaining === undefined ? undefined : formatPendingPriceAvailability(remaining, hasSettledPrice)
	if (!hasSettledPrice) return pendingLabel ?? commonCopy.unavailable

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
			{pendingLabel === undefined ? null : <span className='oracle-price-validity warning'>{pendingLabel}</span>}
		</span>
	)
}
