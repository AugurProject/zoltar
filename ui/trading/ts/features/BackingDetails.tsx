import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { LiveMarket } from '../protocol/live.js'
import * as payoutCopy from '../copy/payout.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'

export function BackingDetails({ market }: { market: LiveMarket }) {
	if (market.loadError !== undefined) return null
	const valuation = market.valuation
	const feeReduction = valuation === undefined || market.settlementCollateralAttoEth === 0n ? undefined : ((market.settlementCollateralAttoEth - valuation.projectedCollateralAttoEth) * 1_000_000n) / market.settlementCollateralAttoEth
	if (feeReduction === undefined) return null
	return (
		<DataGrid dense>
			<MetricField label={payoutCopy.feeProjection}>{formatTrimmedUnits(feeReduction, 4, 4)}%</MetricField>
		</DataGrid>
	)
}
