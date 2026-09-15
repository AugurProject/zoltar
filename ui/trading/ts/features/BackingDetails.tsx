import { formatCollateralEth } from '../lib/shareValue.js'
import { formatUnits } from '../lib/format.js'
import type { LiveMarket } from '../protocol/live.js'
import { formatTimestamp } from './LiveTradingTransactionUi.js'
import * as payoutCopy from '../copy/payout.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'

export function BackingDetails({ market }: { market: LiveMarket }) {
	if (market.loadError !== undefined) return null
	const valuation = market.valuation
	const feeReduction = valuation === undefined || market.settlementCollateralAttoEth === 0n ? undefined : ((market.settlementCollateralAttoEth - valuation.projectedCollateralAttoEth) * 1_000_000n) / market.settlementCollateralAttoEth
	return (
		<details class='backing-details'>
			<summary>{payoutCopy.backingValue}</summary>
			<DataGrid dense>
				<MetricField label={payoutCopy.backingPerSet}>{formatCollateralEth(10n ** 36n, market)}</MetricField>
				{valuation === undefined ? undefined : (
					<>
						<MetricField label={payoutCopy.valuationTime}>{formatTimestamp(valuation.timestamp)}</MetricField>
						<MetricField label={payoutCopy.feeEnd}>{valuation.feeEndTime === (1n << 256n) - 1n ? payoutCopy.feeEndUnknown : formatTimestamp(valuation.feeEndTime)}</MetricField>
						{feeReduction === undefined ? undefined : <MetricField label={valuation.timestamp >= valuation.feeEndTime ? payoutCopy.feeEnded : payoutCopy.feeProjection}>{formatUnits(feeReduction, 4, 4)}%</MetricField>}
					</>
				)}
			</DataGrid>
			<p class='detail payout-note'>
				{payoutCopy.holdingFeeNote}
				{valuation === undefined || valuation.timestamp >= valuation.feeEndTime ? null : <> {payoutCopy.feeProjectionNote}</>}
			</p>
		</details>
	)
}
