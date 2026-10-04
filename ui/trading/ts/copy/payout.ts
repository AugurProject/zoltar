import { outcomeLabel } from './outcomes.js'
export const holdingFeeNote = 'Holding fees reduce ETH payouts until fee accrual ends. Token quantities stay unchanged.'
export const conditionalNote = 'Outcome payouts use the current collateral rate and are 0 ETH if the question resolves to another outcome. These are not sale quotes.'
export const redemptionValue = 'Complete-set redemption value'
export const backingValue = 'Complete-set backing'
export const otherwiseZero = '0 ETH otherwise'
export const unavailable = 'Payout unavailable'
export const valueUnavailable = 'Value unavailable'
export const redemptionUnavailable = 'Redemption unavailable'
export const zeroPayout = '0 ETH · lost'
export const feeProjection = 'Holding fee over next 30 days'

export function formatConditionalPayout(value: string, outcome: 'YES' | 'NO' | 'INVALID') {
	return `${value} if the question resolves ${outcomeLabel(outcome)}`
}

export function formatValidPayout(value: string) {
	return `${value} if the question resolves valid`
}

export function formatWinningPayout(value: string) {
	return `${value} winning payout`
}

export function redeemable(value: string) {
	return `${value} redeemable`
}

export function winningPayout(value: string) {
	return `${value} · winning payout; redemption unavailable`
}

export const positionFeeProjection = 'Holding fee on your holdings over next 30 days'

export function holdingFeeValue(percent: string, fees: { minimum: string; maximum: string } | undefined) {
	if (fees === undefined) return `${percent}%`
	if (fees.minimum === fees.maximum) return `${percent}% · ${fees.minimum}`
	return `${percent}% · ${fees.minimum}–${fees.maximum} depending on outcome`
}
