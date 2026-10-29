import type { OperatorSettings } from '#config/settings'
import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { requiredPortfolioExecutionReserve } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

/** A cure reduces only unused obligations. It never acquires or funds principal. */
export function portfolioCurePlan(observation: PortfolioObservation, position: PortfolioPosition, settings: OperatorSettings, marketAllowed: boolean) {
	const { snapshot } = observation
	if (!observation.selected || !observation.approvedUniverse || !marketAllowed || !snapshot.priceValid || snapshot.timestamp >= snapshot.priceValidUntil || snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return undefined
	if (position.commitment === 0n || position.maxHealthyPrice >= snapshot.liquidationPrice || position.owner === snapshot.owner || position.controllingOwner === snapshot.owner) return undefined
	const spare = snapshot.totalCommitmentAttoEth > snapshot.demandAttoEth ? snapshot.totalCommitmentAttoEth - snapshot.demandAttoEth : 0n
	const supported = (((position.rep * 10_000n) / snapshot.securityMultiplierBps) * 10n ** 18n) / snapshot.liquidationPrice
	if (supported >= position.commitment) return undefined
	const minimum = snapshot.economics.minimumCommitmentAttoEth
	const deficit = position.commitment - supported
	const desired = deficit > minimum ? deficit : minimum
	const removed = [position.commitment, desired, spare].reduce((smallest, value) => (value < smallest ? value : smallest))
	if (removed === 0n || (removed < minimum && removed !== position.commitment)) return undefined
	const previousMinimum = requiredPortfolioExecutionReserve({ commitment: position.commitment, ...snapshot.economics })
	const remainingMinimum = requiredPortfolioExecutionReserve({ commitment: position.commitment - removed, ...snapshot.economics })
	const proportional = (position.executionReserveAttoEth * remainingMinimum) / previousMinimum
	const retained = proportional < remainingMinimum ? proportional : remainingMinimum
	const rewardCeiling = position.executionReserveAttoEth - retained
	const gasBudget = settings.strategy.maximumGasCostAttoEth * 2n // Cure plus eventual earnings withdrawal.
	if (rewardCeiling < gasBudget + settings.portfolioPolicy.minimumNetRewardAttoEth || observation.walletAttoEth < gasBudget + settings.portfolioPolicy.walletReserveAttoEth) return undefined
	return { removed, rewardCeiling, gasBudget }
}
