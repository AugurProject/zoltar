import { totalManagedPrincipalAttoRep } from '#core/security-pool-exposure'
import type { OperatorSettings } from '#config/settings'
import { marketPriceAllowsExecution } from '#core/candidate-selection'
import { securityPoolTakeoverPlan } from '#core/security-pool-strategy'
import { formatDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import type { RuntimeState } from './runtime-state.ts'

export function securityPoolViews(state: RuntimeState, settings: OperatorSettings) {
	const totalPrincipal = totalManagedPrincipalAttoRep(state.securityPools)
	return state.securityPools.map(securityPool => {
		const snapshot = securityPool.snapshot
		const marketAllowed = marketPriceAllowsExecution({ repToken: snapshot.repToken, lastPrice: snapshot.acceptedPrice }, settings, state)
		return {
			address: securityPool.selection.address,
			universeId: securityPool.selection.universeId.toString(),
			selected: securityPool.selected,
			approvedUniverse: securityPool.approvedUniverse,
			blockNumber: snapshot.blockNumber.toString(),
			priceValid: snapshot.priceValid && snapshot.timestamp < snapshot.priceValidUntil,
			principalRep: formatDecimalAmount(snapshot.ownerPrincipalAttoRep),
			commitmentEth: formatDecimalAmount(snapshot.ownerCommitmentAttoEth),
			managedPrincipalRep: formatDecimalAmount(totalPrincipal),
			maximumTotalPrincipalRep: formatDecimalAmount(settings.securityPoolPolicy.maximumTotalPrincipalAttoRep),
			automation: settings.runtime.execute && !state.paused && securityPool.selected && securityPool.approvedUniverse && settings.securityPoolPolicy.allowFundedTakeovers,
			knownPositionCount: securityPool.knownPositionCount.toString(),
			nextPositionId: securityPool.nextScope.nextPositionId.toString(),
			knownAuctionBidCount: (securityPool.knownAuctionBidCount ?? 0n).toString(),
			auctionAfterBidId: (securityPool.nextScope.auctionAfterBidId ?? 0n).toString(),
			positions: securityPool.positions
				.filter(position => position.commitment > 0n)
				.map(position => {
					let takeoverStatus = 'Configure an execution signer to evaluate owner funding'
					if (state.wallet !== undefined) takeoverStatus = securityPoolTakeoverPlan(securityPool, position, settings, totalPrincipal, marketAllowed).reason
					return {
						id: position.auctionTarget === undefined ? position.id.toString() : `auction:${position.auctionTarget.bidId}`,
						label: position.auctionTarget === undefined ? `Position ${position.id}` : `Auction bid ${position.auctionTarget.bidId} · awaiting individual position`,
						commitmentEth: formatDecimalAmount(position.commitment),
						distressed: position.maxHealthyPrice < snapshot.liquidationPrice,
						retirementStatus: position.retirementStatus,
						stalledRetirement: position.stalledRetirement,
						takeoverStatus,
					}
				}),
		}
	})
}
