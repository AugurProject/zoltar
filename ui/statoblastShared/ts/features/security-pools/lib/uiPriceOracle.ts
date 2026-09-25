import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as pricingCopy from '../../../copy/pricing.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../../../protocol/oracleTiming.js'

export type UiPriceOracle = 'uniswap' | 'open-oracle' | 'open-oracle-fallback'

type RepPriceSource = 'uniswap' | 'open-oracle'

/**
 * Why the resolved price came from its source:
 * - `selected`: the setting's own source supplied the price.
 * - `oracle-expired` / `oracle-missing`: the fallback setting used Uniswap because the pool Open Oracle price expired or was never reported.
 * - `unavailable`: no price is available for the setting, so derived figures are unavailable.
 */
type RepPriceReason = 'selected' | 'oracle-expired' | 'oracle-missing' | 'unavailable'

export type ResolvedRepPrice = {
	price: bigint | undefined
	/** Open Oracle settlement time of the price; undefined for a live Uniswap quote. */
	observedAt: bigint | undefined
	reason: RepPriceReason
	setting: UiPriceOracle
	source: RepPriceSource | undefined
	/** True when the price is an Open Oracle report that the pool contracts no longer accept. */
	stale: boolean
	validUntil: bigint | undefined
}

type OpenOracleReading = {
	isPriceValid?: boolean | undefined
	price: bigint | undefined
	settlementTimestamp: bigint | undefined
}

/**
 * The single REP/ETH price resolver behind every capacity, exposure, and health figure in Statoblast.
 * Oracle-manager details are fresher than the pool listing, so they win when both are present.
 */
export function resolveRepPrice({ now, oracleManager, poolOracle, setting, uniswapPrice }: { now: bigint | undefined; oracleManager?: OpenOracleReading | undefined; poolOracle?: OpenOracleReading | undefined; setting: UiPriceOracle; uniswapPrice: bigint | undefined }): ResolvedRepPrice {
	const oraclePrice = oracleManager?.price ?? poolOracle?.price
	const settlementTimestamp = oracleManager?.settlementTimestamp ?? poolOracle?.settlementTimestamp
	const hasOracleReport = oraclePrice !== undefined && settlementTimestamp !== undefined && settlementTimestamp > 0n
	const validUntil = hasOracleReport ? getOracleManagerPriceValidUntilTimestamp(settlementTimestamp) : undefined
	const expiredByTime = now !== undefined && validUntil !== undefined && now >= validUntil
	const oracleStale = oracleManager?.isPriceValid === false || expiredByTime
	const oracleProvablyFresh = !oracleStale && now !== undefined && validUntil !== undefined
	const unavailable: ResolvedRepPrice = { observedAt: undefined, price: undefined, reason: 'unavailable', setting, source: undefined, stale: false, validUntil: undefined }
	const fromOracle: ResolvedRepPrice = { observedAt: settlementTimestamp, price: oraclePrice, reason: 'selected', setting, source: 'open-oracle', stale: oracleStale, validUntil }
	const fromUniswap = (reason: RepPriceReason): ResolvedRepPrice => (uniswapPrice === undefined ? unavailable : { observedAt: undefined, price: uniswapPrice, reason, setting, source: 'uniswap', stale: false, validUntil: undefined })

	if (setting === 'uniswap') return fromUniswap('selected')
	if (setting === 'open-oracle') return hasOracleReport ? fromOracle : unavailable
	if (hasOracleReport && oracleProvablyFresh) return fromOracle
	return fromUniswap(hasOracleReport ? 'oracle-expired' : 'oracle-missing')
}

type RepPriceStatus = { detail: string | undefined; state: 'fresh' | 'stale' | 'unavailable'; title: string }

function describeUnavailable(setting: UiPriceOracle) {
	if (setting === 'uniswap') return pricingCopy.uniswapPriceUnavailable
	if (setting === 'open-oracle') return pricingCopy.noOpenOraclePrice
	return pricingCopy.noRepPrice
}

/** Source and staleness copy shown next to every figure derived from a resolved REP price. */
export function describeRepPriceStatus(repPrice: ResolvedRepPrice, now: bigint | undefined): RepPriceStatus {
	if (repPrice.price === undefined || repPrice.source === undefined) return { detail: undefined, state: 'unavailable', title: describeUnavailable(repPrice.setting) }
	if (repPrice.source === 'uniswap') {
		if (repPrice.reason === 'oracle-expired') return { detail: pricingCopy.openOracleExpiredFallback, state: 'fresh', title: pricingCopy.viaUniswap }
		if (repPrice.reason === 'oracle-missing') return { detail: pricingCopy.openOracleMissingFallback, state: 'fresh', title: pricingCopy.viaUniswap }
		return { detail: pricingCopy.liveQuote, state: 'fresh', title: pricingCopy.viaUniswap }
	}
	if (repPrice.stale) {
		if (now === undefined || repPrice.validUntil === undefined || now < repPrice.validUntil) return { detail: pricingCopy.openOraclePriceNotValid, state: 'stale', title: pricingCopy.stalePrice }
		return { detail: pricingCopy.formatOpenOraclePriceExpiredAgo(formatDuration(now - repPrice.validUntil)), state: 'stale', title: pricingCopy.stalePrice }
	}
	const detail = now === undefined || repPrice.observedAt === undefined ? undefined : pricingCopy.formatPriceObservedAgo(formatDuration(now > repPrice.observedAt ? now - repPrice.observedAt : 0n))
	return { detail, state: 'fresh', title: pricingCopy.viaOpenOracle }
}
