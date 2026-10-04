import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatRoundedUnits } from '../lib/format.js'
import { attoSharesToCollateralAttoEth } from '../lib/shareValue.js'
import { liveBalancesForMarket, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import { formatEthAmount } from '../copy/outcomes.js'
import * as payoutCopy from '../copy/payout.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { lpReserveClaims } from './portfolioModel.js'

function formatFeeEth(amount: bigint) {
	const value = formatRoundedUnits(amount, 18, 6)
	return formatEthAmount(amount > 0n && value === '0' ? '<0.000001' : value)
}

function holdingsFeeRange(market: LiveMarket, balances: LiveBalances, feeCollateralAttoEth: bigint) {
	const claims = lpReserveClaims(market, balances.lp)
	const quantities = [balances.invalid, balances.yes + claims.yes, balances.no + claims.no]
	const outcomes = market.questionOutcome === 3 ? quantities : quantities.filter((_amount, index) => index === market.questionOutcome)
	const first = outcomes[0]
	if (first === undefined) return undefined
	const minimum = outcomes.reduce((least, amount) => (amount < least ? amount : least), first)
	const maximum = outcomes.reduce((most, amount) => (amount > most ? amount : most), first)
	const feeRate = { settlementCollateralAttoEth: feeCollateralAttoEth, shareTokenSupplyAttoShares: market.shareTokenSupplyAttoShares }
	return { minimum: formatFeeEth(attoSharesToCollateralAttoEth(minimum, feeRate)), maximum: formatFeeEth(attoSharesToCollateralAttoEth(maximum, feeRate)) }
}

export function BackingDetails({ market, balances }: { market: LiveMarket; balances?: LiveBalances | undefined }) {
	if (market.loadError !== undefined) return null
	const valuation = market.valuation
	if (valuation === undefined || market.settlementCollateralAttoEth === 0n || market.shareTokenSupplyAttoShares === 0n) return null
	const feeCollateralAttoEth = market.settlementCollateralAttoEth - valuation.projectedCollateralAttoEth
	const feeReduction = (feeCollateralAttoEth * 1_000_000n) / market.settlementCollateralAttoEth
	const scopedBalances = liveBalancesForMarket(balances, market)
	const fees = scopedBalances === undefined ? undefined : holdingsFeeRange(market, scopedBalances, feeCollateralAttoEth)
	return (
		<DataGrid dense>
			<MetricField label={fees === undefined ? payoutCopy.feeProjection : payoutCopy.positionFeeProjection}>{payoutCopy.formatHoldingFeeValue(formatTrimmedUnits(feeReduction, 4, 4), fees)}</MetricField>
		</DataGrid>
	)
}
