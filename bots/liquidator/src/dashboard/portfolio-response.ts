import { array, booleanValue, object, stringValue } from '@zoltar/bot-shared/dashboard/response-validation'

export type PortfolioView = {
	address: string
	universeId: string
	selected: boolean
	approvedUniverse: boolean
	blockNumber: string
	priceValid: boolean
	principalRep: string
	commitmentEth: string
	managedPrincipalRep: string
	maximumTotalPrincipalRep: string
	automation: boolean
	knownPositionCount: string
	nextPositionId: string
	knownAuctionBidCount: string
	nextAuctionBidId: string
	positions: { id: string; label: string; commitmentEth: string; distressed: boolean; retirementStatus: string; stalledRetirement: boolean; takeoverStatus: string }[]
}
export const portfolioView = object<PortfolioView>({
	address: stringValue,
	universeId: stringValue,
	selected: booleanValue,
	approvedUniverse: booleanValue,
	blockNumber: stringValue,
	priceValid: booleanValue,
	principalRep: stringValue,
	commitmentEth: stringValue,
	managedPrincipalRep: stringValue,
	maximumTotalPrincipalRep: stringValue,
	automation: booleanValue,
	knownPositionCount: stringValue,
	nextPositionId: stringValue,
	knownAuctionBidCount: stringValue,
	nextAuctionBidId: stringValue,
	positions: array(
		object<PortfolioView['positions'][number]>({
			id: stringValue,
			label: stringValue,
			commitmentEth: stringValue,
			distressed: booleanValue,
			retirementStatus: stringValue,
			stalledRetirement: booleanValue,
			takeoverStatus: stringValue,
		}),
	),
})
