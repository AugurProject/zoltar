export type ReportClock = 'block' | 'timestamp'

// BinaryOutcome in EscalationGame.sol: Invalid = 0, Yes = 1, No = 2.
export const ESCALATION_OUTCOME = { invalid: '0', yes: '1', no: '2' } as const
export const ETH_QUOTE_DECIMALS = 18
export const USDC_QUOTE_DECIMALS = 6
export const VAULT_WARNING_HEALTH_FACTOR_BPS = 12_000n
const BPS_DENOMINATOR = 10_000n
const PRICE_PRECISION = 10n ** 18n
const LIQUIDATION_REP_BONUS_BPS = 500n

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

type ReportFieldChange = {
	readonly field: string
	readonly kind: 'added' | 'changed' | 'removed'
	readonly before?: unknown
	readonly after?: unknown
}

type ReportRoundEvidence = Record<string, unknown>

const reportRecord = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

const flattenReportFields = (value: unknown, path: string, fields: Map<string, unknown>): void => {
	const record = reportRecord(value)
	const entries = Object.entries(record).toSorted(([left], [right]) => left.localeCompare(right))
	if (entries.length === 0) {
		if (path !== '') fields.set(path, value)
		return
	}
	for (const [key, item] of entries) flattenReportFields(item, path === '' ? key : `${path}.${key}`, fields)
}

const stableReportValue = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(stableReportValue).join(',')}]`
	const record = reportRecord(value)
	if (Object.keys(record).length > 0)
		return `{${Object.entries(record)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableReportValue(item)}`)
			.join(',')}}`
	return JSON.stringify(value) ?? String(value)
}

const reportFieldChanges = (before: unknown, after: unknown): readonly ReportFieldChange[] => {
	const beforeFields = new Map<string, unknown>()
	const afterFields = new Map<string, unknown>()
	flattenReportFields(before, '', beforeFields)
	flattenReportFields(after, '', afterFields)
	return [...new Set([...beforeFields.keys(), ...afterFields.keys()])]
		.toSorted((left, right) => left.localeCompare(right))
		.flatMap((field): readonly ReportFieldChange[] => {
			const hadBefore = beforeFields.has(field)
			const hasAfter = afterFields.has(field)
			const previous = beforeFields.get(field)
			const current = afterFields.get(field)
			if (hadBefore && hasAfter && stableReportValue(previous) === stableReportValue(current)) return []
			if (!hadBefore) return [{ field, kind: 'added', after: current }]
			if (!hasAfter) return [{ field, kind: 'removed', before: previous }]
			return [{ field, kind: 'changed', before: previous, after: current }]
		})
}

// Evidence is newest first. The extra row fetched for keyset pagination provides
// the comparison baseline for the last row that is returned to the client.
export const reportRoundChanges = (rows: readonly ReportRoundEvidence[]): readonly ReportRoundEvidence[] =>
	rows.map((row, index) => {
		const previous = rows[index + 1]
		const currentData = reportRecord(row['report_data'])
		const previousData = previous === undefined ? {} : reportRecord(previous['report_data'])
		return {
			...row,
			report_data: currentData,
			comparison: {
				state: previous === undefined ? 'initial' : 'compared',
				previousRoundNumber: previous?.['round_number'],
				previousBlockNumber: previous?.['block_number'],
				changes: reportFieldChanges(previousData, currentData),
			},
		}
	})

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

const positiveInteger = (value: unknown, name: string): bigint => {
	if (typeof value !== 'string') throw new Error(`${name} must be a non-negative decimal integer`)
	if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`)
	return BigInt(value)
}

const ceilDiv = (numerator: bigint, denominator: bigint): bigint => {
	if (denominator <= 0n) throw new Error('Exact division requires a positive denominator')
	return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n
}

export type VaultRiskInput = {
	readonly poolHeldBackingAttoRep: unknown
	readonly disputeStakedAttoRep: unknown
	readonly openInterestAttoEth: unknown
	readonly repPerEth1e18: string
	readonly securityMultiplierBps: string
	readonly targetHealthFactorBps: string
	readonly badDebtAttoEth: unknown
}

export const vaultRisk = (input: VaultRiskInput) => {
	const backing = positiveInteger(input.poolHeldBackingAttoRep, 'poolHeldBackingAttoRep')
	const dispute = positiveInteger(input.disputeStakedAttoRep, 'disputeStakedAttoRep')
	const openInterest = positiveInteger(input.openInterestAttoEth, 'openInterestAttoEth')
	const price = positiveInteger(input.repPerEth1e18, 'repPerEth1e18')
	const securityMultiplier = positiveInteger(input.securityMultiplierBps, 'securityMultiplierBps')
	const target = positiveInteger(input.targetHealthFactorBps, 'targetHealthFactorBps')
	const badDebt = positiveInteger(input.badDebtAttoEth, 'badDebtAttoEth')
	if (openInterest === 0n)
		return {
			protocolState: badDebt > 0n ? ('bad-debt' as const) : ('healthy' as const),
			scannerSeverity: badDebt > 0n ? ('critical' as const) : ('healthy' as const),
			scannerReason: badDebt > 0n ? 'Vault has recorded bad debt' : 'Vault has no open-interest obligation',
			healthFactorBps: undefined,
			targetHealthFactorBps: target.toString(),
			liquidationBoundaryBps: BPS_DENOMINATOR.toString(),
		}
	if (price === 0n)
		return {
			protocolState: 'unavailable' as const,
			scannerSeverity: 'unavailable' as const,
			scannerReason: 'The accounting REP/ETH price is zero or unavailable',
			healthFactorBps: undefined,
			targetHealthFactorBps: target.toString(),
			liquidationBoundaryBps: BPS_DENOMINATOR.toString(),
		}
	const baseRequired = ceilDiv(openInterest * price, PRICE_PRECISION)
	const associatedBeforeFactor = ceilDiv(baseRequired * securityMultiplier, BPS_DENOMINATOR)
	const migrationMultiplier = [BPS_DENOMINATOR + (securityMultiplier - BPS_DENOMINATOR) / 2n, BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS].reduce(
		(maximum, candidate) => (candidate > maximum ? candidate : maximum),
		0n,
	)
	const freeBeforeFactor = ceilDiv(baseRequired * migrationMultiplier, BPS_DENOMINATOR)
	const associatedFactor = associatedBeforeFactor === 0n ? 0n : ((backing + dispute) * BPS_DENOMINATOR) / associatedBeforeFactor
	const freeFactor = freeBeforeFactor === 0n ? 0n : (backing * BPS_DENOMINATOR) / freeBeforeFactor
	const healthFactor = associatedFactor < freeFactor ? associatedFactor : freeFactor
	const protocolState = badDebt > 0n ? ('bad-debt' as const) : healthFactor < BPS_DENOMINATOR ? ('liquidatable' as const) : ('healthy' as const)
	const scannerSeverity =
		protocolState !== 'healthy' ? ('critical' as const) : healthFactor < VAULT_WARNING_HEALTH_FACTOR_BPS ? ('warning' as const) : ('healthy' as const)
	return {
		protocolState,
		scannerSeverity,
		scannerReason:
			badDebt > 0n
				? 'Vault has recorded bad debt'
				: healthFactor < BPS_DENOMINATOR
					? 'Exact contract health constraints fail at the liquidation boundary'
					: healthFactor < VAULT_WARNING_HEALTH_FACTOR_BPS
						? `Health factor is below the scanner warning threshold of ${VAULT_WARNING_HEALTH_FACTOR_BPS} bps`
						: 'Health factor is above the scanner warning threshold',
		healthFactorBps: healthFactor.toString(),
		targetHealthFactorBps: target.toString(),
		liquidationBoundaryBps: BPS_DENOMINATOR.toString(),
		calculation: {
			baseRequiredRepAttoRep: baseRequired.toString(),
			associatedRequiredBeforeHealthFactorAttoRep: associatedBeforeFactor.toString(),
			freeRequiredBeforeHealthFactorAttoRep: freeBeforeFactor.toString(),
			migrationSecurityMultiplierBps: migrationMultiplier.toString(),
		},
	}
}

export const poolCapacity = (settlementCollateralAttoEth: unknown, mintingCapacityAttoEth: unknown) => {
	const used = positiveInteger(settlementCollateralAttoEth, 'settlementCollateralAttoEth')
	const capacity = positiveInteger(mintingCapacityAttoEth, 'mintingCapacityAttoEth')
	const available = capacity > used ? capacity - used : 0n
	return {
		usedAttoEth: used.toString(),
		capacityAttoEth: capacity.toString(),
		availableAttoEth: available.toString(),
		utilizationBps: capacity === 0n ? undefined : ((used * BPS_DENOMINATOR) / capacity).toString(),
	}
}

export type SwapAnalyticsInput = {
	readonly yesForNo: boolean
	readonly amountIn: string
	readonly amountOut: string
	readonly feeAmount: string
	readonly resultingYesReserve: string
	readonly resultingNoReserve: string
}

export const swapAnalytics = (input: SwapAnalyticsInput) => {
	const amountIn = positiveInteger(input.amountIn, 'amountIn')
	const amountOut = positiveInteger(input.amountOut, 'amountOut')
	const feeAmount = positiveInteger(input.feeAmount, 'feeAmount')
	const resultingYesReserve = positiveInteger(input.resultingYesReserve, 'resultingYesReserve')
	const resultingNoReserve = positiveInteger(input.resultingNoReserve, 'resultingNoReserve')
	const resultingReserveIn = input.yesForNo ? resultingYesReserve : resultingNoReserve
	const resultingReserveOut = input.yesForNo ? resultingNoReserve : resultingYesReserve
	if (resultingReserveIn < amountIn) throw new Error('Swap resulting input reserve is smaller than amountIn')
	const reserveInBefore = resultingReserveIn - amountIn
	const reserveOutBefore = resultingReserveOut + amountOut
	const impactDenominator = reserveOutBefore * amountIn
	const impactNumerator = impactDenominator > amountOut * reserveInBefore ? impactDenominator - amountOut * reserveInBefore : 0n
	const [reducedImpactNumerator, reducedImpactDenominator] = reduced(impactNumerator, impactDenominator)
	return {
		direction: input.yesForNo ? ('YES to NO' as const) : ('NO to YES' as const),
		baseAsset: input.yesForNo ? ('YES' as const) : ('NO' as const),
		quoteAsset: input.yesForNo ? ('NO' as const) : ('YES' as const),
		amountIn: amountIn.toString(),
		amountOut: amountOut.toString(),
		feeAmount: feeAmount.toString(),
		reserveInBefore: reserveInBefore.toString(),
		reserveOutBefore: reserveOutBefore.toString(),
		spotPriceBefore: { numerator: reserveOutBefore.toString(), denominator: reserveInBefore.toString() },
		spotPriceAfter: { numerator: resultingReserveOut.toString(), denominator: resultingReserveIn.toString() },
		executionPrice: { numerator: amountOut.toString(), denominator: amountIn.toString() },
		priceImpact:
			impactDenominator === 0n
				? { state: 'Unavailable' as const }
				: {
						state: 'Available' as const,
						numerator: reducedImpactNumerator.toString(),
						denominator: reducedImpactDenominator.toString(),
						bps: ((impactNumerator * BPS_DENOMINATOR) / impactDenominator).toString(),
					},
	}
}

export type ExactPriceObservation = {
	readonly timestamp: string
	readonly numerator: string
	readonly denominator: string
}

const gcd = (left: bigint, right: bigint): bigint => {
	let a = left < 0n ? -left : left
	let b = right < 0n ? -right : right
	while (b !== 0n) [a, b] = [b, a % b]
	return a
}

const reduced = (numerator: bigint, denominator: bigint): readonly [bigint, bigint] => {
	const divisor = gcd(numerator, denominator)
	return divisor === 0n ? [0n, 1n] : [numerator / divisor, denominator / divisor]
}

export const fixedWindowTwap = (observations: readonly ExactPriceObservation[], windowStart: string, windowEnd: string) => {
	const start = positiveInteger(windowStart, 'windowStart')
	const end = positiveInteger(windowEnd, 'windowEnd')
	if (end <= start) throw new Error('TWAP window end must be after its start')
	const ordered = observations
		.map((observation) => ({
			timestamp: positiveInteger(observation.timestamp, 'observation timestamp'),
			numerator: positiveInteger(observation.numerator, 'price numerator'),
			denominator: positiveInteger(observation.denominator, 'price denominator'),
		}))
		.filter(({ denominator }) => denominator > 0n)
		.sort((left, right) => (left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0))
	let active = [...ordered].reverse().find(({ timestamp }) => timestamp <= start)
	let cursor = start
	let weightedNumerator = 0n
	let weightedDenominator = 1n
	let covered = 0n
	for (const observation of ordered) {
		if (observation.timestamp <= start) continue
		if (observation.timestamp >= end) break
		if (active !== undefined && observation.timestamp > cursor) {
			const duration = observation.timestamp - cursor
			const sumNumerator = weightedNumerator * active.denominator + active.numerator * duration * weightedDenominator
			const sumDenominator = weightedDenominator * active.denominator
			const nextWeighted = reduced(sumNumerator, sumDenominator)
			weightedNumerator = nextWeighted[0]
			weightedDenominator = nextWeighted[1]
			covered += duration
		}
		active = observation
		cursor = observation.timestamp
	}
	if (active !== undefined && cursor < end) {
		const duration = end - cursor
		const sumNumerator = weightedNumerator * active.denominator + active.numerator * duration * weightedDenominator
		const sumDenominator = weightedDenominator * active.denominator
		const nextWeighted = reduced(sumNumerator, sumDenominator)
		weightedNumerator = nextWeighted[0]
		weightedDenominator = nextWeighted[1]
		covered += duration
	}
	if (covered === 0n) return { state: 'Insufficient observations' as const, coverageSeconds: '0', windowSeconds: (end - start).toString() }
	const [numerator, denominator] = reduced(weightedNumerator, weightedDenominator * covered)
	return {
		state: covered === end - start ? ('Available' as const) : ('Partial coverage' as const),
		numerator: numerator.toString(),
		denominator: denominator.toString(),
		coverageSeconds: covered.toString(),
		windowSeconds: (end - start).toString(),
	}
}

export const auctionDemandCurve = (bids: readonly { readonly tick: string; readonly amountAttoEth: unknown }[]) => {
	const totals = new Map<bigint, bigint>()
	for (const bid of bids) {
		const tick = BigInt(bid.tick)
		totals.set(tick, (totals.get(tick) ?? 0n) + positiveInteger(bid.amountAttoEth, 'bid amount'))
	}
	let cumulative = 0n
	return [...totals]
		.sort(([left], [right]) => (left > right ? -1 : left < right ? 1 : 0))
		.map(([tick, amountAttoEth]) => {
			cumulative += amountAttoEth
			return { tick: tick.toString(), amountAttoEth: amountAttoEth.toString(), cumulativeDemandAttoEth: cumulative.toString() }
		})
}

export const candlestickBuckets = (observations: readonly ExactPriceObservation[], bucketSeconds: string) => {
	const size = positiveInteger(bucketSeconds, 'bucketSeconds')
	if (size === 0n) throw new Error('Candlestick bucket size must be positive')
	const buckets = new Map<string, Array<{ timestamp: bigint; numerator: bigint; denominator: bigint }>>()
	for (const observation of observations) {
		const timestamp = positiveInteger(observation.timestamp, 'observation timestamp')
		const denominator = positiveInteger(observation.denominator, 'price denominator')
		if (denominator === 0n) continue
		const bucket = ((timestamp / size) * size).toString()
		const entries = buckets.get(bucket) ?? []
		entries.push({ timestamp, numerator: positiveInteger(observation.numerator, 'price numerator'), denominator })
		buckets.set(bucket, entries)
	}
	const compare = (left: { numerator: bigint; denominator: bigint }, right: { numerator: bigint; denominator: bigint }): number => {
		const leftScaled = left.numerator * right.denominator
		const rightScaled = right.numerator * left.denominator
		return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0
	}
	const serialized = (value: { numerator: bigint; denominator: bigint }) => ({
		numerator: value.numerator.toString(),
		denominator: value.denominator.toString(),
	})
	return [...buckets]
		.sort(([left], [right]) => (BigInt(left) < BigInt(right) ? -1 : 1))
		.map(([bucketStart, entries]) => {
			entries.sort((left, right) => (left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0))
			const open = entries[0]
			const close = entries.at(-1)
			if (open === undefined || close === undefined) throw new Error('Candlestick bucket is unexpectedly empty')
			const low = entries.reduce((current, candidate) => (compare(candidate, current) < 0 ? candidate : current), open)
			const high = entries.reduce((current, candidate) => (compare(candidate, current) > 0 ? candidate : current), open)
			return { bucketStart, open: serialized(open), high: serialized(high), low: serialized(low), close: serialized(close), observations: entries.length }
		})
}
