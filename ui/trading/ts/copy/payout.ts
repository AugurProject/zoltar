import { outcomeLabel } from './outcomes.js'
export const holdingFeeNote = 'Holding fees reduce ETH payouts until fee accrual ends. Token quantities stay unchanged.'
export const conditionalNote = 'Outcome payouts are at current backing: 0 ETH if the outcome loses. These are not sale quotes.'
export const redemptionValue = 'Complete-set redemption value'
export const backingValue = 'Complete-set backing'
export const otherwiseZero = '0 ETH otherwise'
export const unavailable = 'Payout unavailable'
export const redemptionUnavailable = 'Redemption unavailable'
export const zeroPayout = '0 ETH · lost'
export const feeProjection = 'Holding fee over next 30 days'

export function conditionalPayout(value: string, outcome: 'YES' | 'NO' | 'INVALID') {
	return `${value} if ${outcomeLabel(outcome)} wins`
}

export function redeemable(value: string) {
	return `${value} redeemable`
}

export function winningPayout(value: string) {
	return `${value} · winning payout; redemption unavailable`
}
