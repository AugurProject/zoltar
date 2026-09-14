import { formatCollateralEth } from '../lib/shareValue.js'
import { formatUnits } from '../lib/format.js'
import type { LiveMarket } from '../protocol/live.js'
import { formatTimestamp } from './LiveTradingTransactionUi.js'
import * as payoutCopy from '../copy/payout.js'

export function BackingDetails({ market }: { market: LiveMarket }) {
	if (market.loadError !== undefined) return null
	const valuation = market.valuation
	const feeReduction = valuation === undefined || market.settlementCollateralAttoEth === 0n ? undefined : ((market.settlementCollateralAttoEth - valuation.projectedCollateralAttoEth) * 1_000_000n) / market.settlementCollateralAttoEth
	return (
		<details class='operation-details'>
			<summary>{payoutCopy.backingValue}</summary>
			<dl class='metrics'>
				<div>
					<dt>{payoutCopy.backingPerSet}</dt>
					<dd>{formatCollateralEth(10n ** 36n, market)}</dd>
				</div>
				{valuation === undefined ? null : (
					<>
						<div>
							<dt>{payoutCopy.valuationTime}</dt>
							<dd>{formatTimestamp(valuation.timestamp)}</dd>
						</div>
						<div>
							<dt>{payoutCopy.feeEnd}</dt>
							<dd>{valuation.feeEndTime === (1n << 256n) - 1n ? payoutCopy.feeEndUnknown : formatTimestamp(valuation.feeEndTime)}</dd>
						</div>
						{feeReduction === undefined ? null : (
							<div>
								<dt>{valuation.timestamp >= valuation.feeEndTime ? payoutCopy.feeEnded : payoutCopy.feeProjection}</dt>
								<dd>{formatUnits(feeReduction, 4, 4)}%</dd>
							</div>
						)}
					</>
				)}
			</dl>
			<p class='field-note'>
				{payoutCopy.holdingFeeNote}
				{valuation === undefined || valuation.timestamp >= valuation.feeEndTime ? null : <> {payoutCopy.feeProjectionNote}</>}
			</p>
		</details>
	)
}
