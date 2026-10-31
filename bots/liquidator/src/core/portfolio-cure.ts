import type { OperatorSettings } from '#config/settings'
import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { portfolioCureOutcome } from './portfolio-cure-state.ts'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'

/** A cure reduces only unused obligations. It never acquires or funds principal. */
export function portfolioCurePlan(observation: PortfolioObservation, position: PortfolioPosition, settings: OperatorSettings, marketAllowed: boolean) {
	const { snapshot } = observation
	if (!observation.selected || !observation.approvedUniverse || !marketAllowed || !snapshot.priceValid || snapshot.timestamp >= snapshot.priceValidUntil || snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return undefined
	if (position.commitment === 0n || position.maxHealthyPrice >= snapshot.liquidationPrice || position.owner === snapshot.owner || position.controllingOwner === snapshot.owner) return undefined
	const { removed, reward: rewardCeiling } = portfolioCureOutcome(observation, position)
	if (removed === 0n || rewardCeiling === 0n) return undefined
	const gasBudget = settings.strategy.maximumGasCostAttoEth * 2n // Cure plus eventual earnings withdrawal.
	const minimumReward = ceilDiv((gasBudget + settings.portfolioPolicy.minimumNetRewardAttoEth) * portfolioRewardPrice(observation), 10n ** 18n)
	if (rewardCeiling < minimumReward || observation.walletAttoEth < gasBudget + settings.portfolioPolicy.walletReserveAttoEth) return undefined
	return { removed, rewardCeiling, minimumReward, gasBudget }
}

/** A larger REP/ETH price gives a lower ETH valuation of a REP award. */
function portfolioRewardPrice(observation: PortfolioObservation) {
	const { snapshot } = observation
	return [snapshot.conservativePrice, snapshot.ownerConservativePrice, snapshot.liquidationPrice].reduce((largest, value) => (value > largest ? value : largest))
}

export function portfolioEarningsCoverGas(observation: PortfolioObservation, settings: OperatorSettings, marketAllowed: boolean) {
	const { snapshot } = observation
	const price = portfolioRewardPrice(observation)
	const repValue = marketAllowed && snapshot.priceValid && snapshot.timestamp < snapshot.priceValidUntil && price > 0n ? (snapshot.ownerAccount.feesAttoRep * 10n ** 18n) / price : 0n
	return (
		observation.selected && observation.approvedUniverse && snapshot.ownerAccount.feesAttoEth + repValue >= settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.minimumNetRewardAttoEth && observation.walletAttoEth >= settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.walletReserveAttoEth
	)
}
