export type ReportClock = 'block' | 'timestamp'

// BinaryOutcome in EscalationGame.sol: Invalid = 0, Yes = 1, No = 2.
export const ESCALATION_OUTCOME = { invalid: '0', yes: '1', no: '2' } as const
export const ETH_QUOTE_DECIMALS = 18
export const USDC_QUOTE_DECIMALS = 6

export const quoteDecimalsFallback = (contractKind: string | undefined): number => (contractKind === 'usdc' ? USDC_QUOTE_DECIMALS : ETH_QUOTE_DECIMALS)

export type ReportLifecycleInput = {
	readonly eventName: 'ReportSubmitted' | 'ReportDisputed' | 'ReportSettled'
	readonly flags?: string
	readonly reportTimestamp?: string
	readonly disputeDelay?: string
	readonly settlementTime?: string
	readonly indexedBlock: string
	readonly indexedTimestamp: string
}

export type LifecycleState = {
	readonly state: string
	readonly clock: ReportClock
	readonly disputeBoundary?: string
	readonly settlementBoundary?: string
	readonly nextTransition?: string
}

const nonNegative = (value: string | undefined): bigint | undefined => {
	if (value === undefined || !/^\d+$/.test(value)) return undefined
	return BigInt(value)
}

export const reportLifecycle = (input: ReportLifecycleInput): LifecycleState => {
	const flags = nonNegative(input.flags) ?? 0n
	const clock: ReportClock = (flags & 1n) === 1n ? 'timestamp' : 'block'
	if (input.eventName === 'ReportSettled') return { state: 'Settled', clock }
	const reportTimestamp = nonNegative(input.reportTimestamp)
	const disputeDelay = nonNegative(input.disputeDelay)
	const settlementTime = nonNegative(input.settlementTime)
	if (reportTimestamp === undefined || disputeDelay === undefined || settlementTime === undefined) return { state: 'Awaiting indexed evidence', clock }
	const current = nonNegative(clock === 'timestamp' ? input.indexedTimestamp : input.indexedBlock)
	if (current === undefined) return { state: 'Awaiting indexed evidence', clock }
	const disputeBoundary = reportTimestamp + disputeDelay
	const settlementBoundary = reportTimestamp + settlementTime
	if (current < disputeBoundary)
		return {
			state: 'Waiting for dispute window',
			clock,
			disputeBoundary: disputeBoundary.toString(),
			settlementBoundary: settlementBoundary.toString(),
			nextTransition: disputeBoundary.toString(),
		}
	if (current < settlementBoundary)
		return {
			state: 'Dispute window open',
			clock,
			disputeBoundary: disputeBoundary.toString(),
			settlementBoundary: settlementBoundary.toString(),
			nextTransition: settlementBoundary.toString(),
		}
	return {
		state: 'Settleable',
		clock,
		disputeBoundary: disputeBoundary.toString(),
		settlementBoundary: settlementBoundary.toString(),
	}
}

export type AuctionLifecycleInput = {
	readonly started: boolean
	readonly finalized: boolean
	readonly startTimestamp?: string
	readonly endTimestamp?: string
	readonly indexedTimestamp: string
	readonly bidCount: number
	readonly settlementCount: number
}

export const auctionLifecycle = (input: AuctionLifecycleInput): string => {
	if (!input.started) return 'Scheduled'
	if (input.finalized) return input.settlementCount < input.bidCount ? 'Bid settlements outstanding' : 'Fully settled'
	const current = nonNegative(input.indexedTimestamp)
	const start = nonNegative(input.startTimestamp)
	const end = nonNegative(input.endTimestamp)
	if (current === undefined || start === undefined || end === undefined) return 'Awaiting indexed evidence'
	if (current < start) return 'Scheduled'
	if (current < end) return 'Open'
	return 'Awaiting finalization'
}

export const priceFreshness = (indexedTimestamp: string, observedTimestamp: string | undefined, validitySeconds = 86_400n) => {
	const indexed = nonNegative(indexedTimestamp)
	const observed = nonNegative(observedTimestamp)
	if (indexed === undefined || observed === undefined) return { state: 'Unavailable' as const }
	const age = indexed > observed ? indexed - observed : 0n
	return { state: age <= validitySeconds ? ('Fresh' as const) : ('Stale' as const), ageSeconds: age.toString() }
}
