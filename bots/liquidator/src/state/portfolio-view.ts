import type { OperatorSettings } from '#config/settings'
import { marketPriceAllowsExecution } from '#core/candidate-selection'
import { portfolioTakeoverPlan } from '#core/portfolio-strategy'
import { formatDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import type { RuntimeState } from './runtime-state.ts'

export function portfolioViews(state: RuntimeState, settings: OperatorSettings) {
	const totalPrincipal = state.portfolios.reduce((sum, portfolio) => sum + (portfolio.managedPrincipalAttoRep ?? portfolio.snapshot.ownerPrincipalAttoRep), 0n)
	return state.portfolios.map(portfolio => {
		const snapshot = portfolio.snapshot
		const marketAllowed = marketPriceAllowsExecution({ repToken: snapshot.repToken, lastPrice: snapshot.acceptedPrice }, settings, state)
		return {
			address: portfolio.selection.address,
			universeId: portfolio.selection.universeId.toString(),
			selected: portfolio.selected,
			approvedUniverse: portfolio.approvedUniverse,
			blockNumber: snapshot.blockNumber.toString(),
			priceValid: snapshot.priceValid && snapshot.timestamp < snapshot.priceValidUntil,
			principalRep: formatDecimalAmount(snapshot.ownerPrincipalAttoRep),
			commitmentEth: formatDecimalAmount(snapshot.ownerCommitmentAttoEth),
			managedPrincipalRep: formatDecimalAmount(totalPrincipal),
			maximumTotalPrincipalRep: formatDecimalAmount(settings.portfolioPolicy.maximumTotalPrincipalAttoRep),
			automation: settings.portfolioPolicy.allowFundedTakeovers,
			knownPositionCount: portfolio.knownPositionCount.toString(),
			nextPositionId: portfolio.nextScope.nextPositionId.toString(),
			knownAuctionBidCount: (portfolio.knownAuctionBidCount ?? 0n).toString(),
			auctionAfterBidId: (portfolio.nextScope.auctionAfterBidId ?? 0n).toString(),
			positions: portfolio.positions
				.filter(position => position.commitment > 0n)
				.map(position => {
					let takeoverStatus = 'Configure an execution signer to evaluate owner funding'
					if (state.wallet !== undefined) takeoverStatus = portfolioTakeoverPlan(portfolio, position, settings, totalPrincipal, marketAllowed).reason
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
