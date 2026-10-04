import { outcomeLabel } from './outcomes.js'
export const holdingFeeNote = 'Holding fees reduce ETH payouts until fee accrual ends. Token quantities stay unchanged.'
export const conditionalNote = 'Outcome payouts use the current collateral rate and are 0 ETH if the question resolves to another outcome. These are not sale quotes.'
export const redemptionValue = 'Complete-set redemption value'
export const backingValue = 'Complete-set backing'
export const unavailable = 'Payout unavailable'
export const redemptionUnavailable = 'Redemption unavailable'
export const zeroPayout = '0 ETH · lost'
export const backingPerSet = 'ETH backing per complete set'
export const feeProjection = 'Holding fee over next 30 days'
export const feeProjectionNote = 'Estimated at the current rate, stopping at the fee end date.'
export const feeEnd = 'Fee accrual ends'
export const feeEndUnknown = 'Not yet determined'
export const valuationTime = 'Backing as of'
export const otherwiseZero = '0 ETH otherwise'

export function formatConditionalPayout(value: string, outcome: 'YES' | 'NO' | 'INVALID') {
	return `${value} if the question resolves ${outcomeLabel(outcome)}`
}

export function redeemable(value: string) {
	return `${value} redeemable`
}

export function winningPayout(value: string) {
	return `${value} · winning payout; redemption unavailable`
}
