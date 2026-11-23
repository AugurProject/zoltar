import type { OperatorSettings } from '#config/settings'
import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'

/** A larger REP/ETH price gives a lower ETH valuation of earned REP. */
function securityPoolEarningsPrice(observation: SecurityPoolObservation) {
	const { snapshot } = observation
	return [snapshot.conservativePrice, snapshot.ownerConservativePrice, snapshot.liquidationPrice].reduce((largest, value) => (value > largest ? value : largest))
}

export function securityPoolEarningsCoverGas(observation: SecurityPoolObservation, settings: OperatorSettings, marketAllowed: boolean) {
	const { snapshot } = observation
	const price = securityPoolEarningsPrice(observation)
	const repValue = marketAllowed && snapshot.priceValid && snapshot.timestamp < snapshot.priceValidUntil && price > 0n ? (snapshot.accruedFeesAttoRep * 10n ** 18n) / price : 0n
	return (
		observation.selected && observation.approvedUniverse && snapshot.accruedFeesAttoEth + repValue >= settings.strategy.maximumGasCostAttoEth + settings.securityPoolPolicy.minimumNetRewardAttoEth && observation.walletAttoEth >= settings.strategy.maximumGasCostAttoEth + settings.securityPoolPolicy.walletReserveAttoEth
	)
}
