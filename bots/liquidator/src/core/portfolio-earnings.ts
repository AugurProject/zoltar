import type { OperatorSettings } from '#config/settings'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'

/** A larger REP/ETH price gives a lower ETH valuation of earned REP. */
function portfolioEarningsPrice(observation: PortfolioObservation) {
	const { snapshot } = observation
	return [snapshot.conservativePrice, snapshot.ownerConservativePrice, snapshot.liquidationPrice].reduce((largest, value) => (value > largest ? value : largest))
}

export function portfolioEarningsCoverGas(observation: PortfolioObservation, settings: OperatorSettings, marketAllowed: boolean) {
	const { snapshot } = observation
	const price = portfolioEarningsPrice(observation)
	const repValue = marketAllowed && snapshot.priceValid && snapshot.timestamp < snapshot.priceValidUntil && price > 0n ? (snapshot.ownerAccount.feesAttoRep * 10n ** 18n) / price : 0n
	return (
		observation.selected && observation.approvedUniverse && snapshot.ownerAccount.feesAttoEth + repValue >= settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.minimumNetRewardAttoEth && observation.walletAttoEth >= settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.walletReserveAttoEth
	)
}
