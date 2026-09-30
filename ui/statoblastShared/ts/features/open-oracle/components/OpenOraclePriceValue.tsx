import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { getOracleLastPriceDisplay, getOraclePriceValidityPresentation } from '../lib/openOracle.js'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { formatPendingPriceAvailability } from '../../../copy/pricing.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../../../protocol/oracleTiming.js'

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
	const visible = usePageVisible()
	// The estimate counts wall-clock seconds from the last chain read; the ticking pauses in a hidden tab and catches up on return.
	const anchor = useMemo(() => {
		const wallTime = Date.now()
		return { timestamp: resolvedCurrentTimestamp ?? BigInt(Math.floor(wallTime / 1000)), wallTime }
	}, [resolvedCurrentTimestamp])
	const hasSettledPrice = lastPrice !== undefined && lastSettlementTimestamp > 0n
	const validUntilTimestamp = hasSettledPrice ? (priceValidUntilTimestamp ?? getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp)) : undefined
	// Tick while a pending report counts down or the settled price is still valid, so both labels follow the estimated chain time.
	const shouldTick = pendingReportReadyAtTimestamp !== undefined || (resolvedCurrentTimestamp !== undefined && validUntilTimestamp !== undefined && estimatedTimestamp <= validUntilTimestamp)
	useEffect(() => {
		const update = () => setEstimatedTimestamp(anchor.timestamp + BigInt(Math.floor((Date.now() - anchor.wallTime) / 1000)))
		update()
		if (!shouldTick || !visible) return
		const interval = setInterval(update, 1000)
		return () => clearInterval(interval)
	}, [anchor, shouldTick, visible])
	const remaining = pendingReportReadyAtTimestamp === undefined ? undefined : pendingReportReadyAtTimestamp - estimatedTimestamp
	const pendingLabel = remaining === undefined ? undefined : formatPendingPriceAvailability(remaining, hasSettledPrice)
	if (!hasSettledPrice) return pendingLabel ?? commonCopy.unavailable

	const validityPresentation =
		resolvedCurrentTimestamp === undefined
			? undefined
			: getOraclePriceValidityPresentation({
					currentTimestamp: estimatedTimestamp,
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
