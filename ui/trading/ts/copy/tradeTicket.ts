export const buy = 'Buy'
export const sell = 'Sell'
export const tradeDirection = 'Trade direction'
export const youPay = 'You pay'
export const sharesToSell = 'Shares to sell'
export const quarter = '25%'
export const half = '50%'
export const max = 'Max'
export const noBalance = '—'
export const sellShortcutsLabel = 'Sell amount shortcuts'
export const estimateHeading = 'Estimate'
export const estimateNote = 'Estimated from current pool reserves. The price is checked again before your wallet opens.'
export const youReceiveEstimate = 'You receive ≈'
export const youSellEstimate = 'You sell'
export const minimumReceived = 'Minimum received'
export const priceImpact = 'Price impact'
export const averagePrice = 'Average price'
export const invalidInsurance = 'INVALID insurance'
export const invalidUsed = 'INVALID used'
export const poolFee = 'Pool fee'
export const poolFeePaid = 'Pool fee paid'
export const completeSets = 'Complete sets'
export const moreDetails = 'Trade details'
export const updatingEstimate = 'Updating estimate…'
export const amountTooSmall = 'Amount too small to trade.'
export const invalidEthAmount = 'Enter an ETH amount with at most 18 decimal places.'
export const invalidShareAmount = 'Enter a share amount with at most 36 decimal places.'
export const invalidCoverageReason = 'Not enough INVALID to insure this sale.'
export const priceImpactBlockedReason = 'Trade a smaller amount.'
export const acknowledgeImpactReason = 'Confirm the price impact first.'

export function buyOutcome(outcome: 'YES' | 'NO') {
	return `Buy ${outcome}`
}

export function sellOutcome(outcome: 'YES' | 'NO') {
	return `Sell ${outcome}`
}

export function swapped(outcome: 'YES' | 'NO') {
	return `${outcome} swapped in the pool`
}

export function walletBalance(amount: string) {
	return `Wallet: ${amount}`
}

export function holdingHint(holding: string) {
	return `You hold ${holding}`
}

export function sellableHint(holding: string, sellable: string) {
	return `You hold ${holding}; up to ${sellable} can be sold now.`
}

export function priceImpactCaution(percent: string) {
	return `Price impact ${percent}%. Smaller trades get a better average price.`
}

export function priceImpactWarning(percent: string) {
	return `High price impact: ${percent}%. This trade moves the pool well away from the current price.`
}

export function priceImpactBlocked(percent: string) {
	return `Price impact ${percent}% is above the 15% limit: this pool is too thin for a trade this size.`
}

export function acknowledgeImpact(percent: string) {
	return `I accept a ${percent}% price impact`
}

export function invalidCoverageExplanation(needed: string, held: string, sellable: string, outcome: 'YES' | 'NO') {
	return `Selling pays out ETH by redeeming complete sets, so each set needs 1 INVALID. This sale needs ${needed}; you hold ${held}. You can sell up to ${sellable} now, or keep the rest of your ${outcome} as shares.`
}

export function sellInsteadAction(amount: string) {
	return `Sell ${amount} instead`
}

export function priceMoved(detail: string) {
	return `The price moved since your estimate: ${detail}. The estimate has been refreshed; review it and press the button again.`
}
