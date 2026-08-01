const BPS = 10_000n

export async function requireCanonicalBlock(blockNumber: bigint, expectedHash: `0x${string}`, readCanonicalHash: (blockNumber: bigint) => Promise<`0x${string}` | undefined>) {
	const canonicalHash = await readCanonicalHash(blockNumber)
	if (canonicalHash === undefined || canonicalHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Canonical block changed during market observation')
}

export function discardDexMarketObservations(observations: readonly MarketConsensusObservation[]) {
	return observations.filter(observation => observation.kind === 'cex')
}

export function marketObservationsForAsset(observations: readonly MarketConsensusObservation[], assetId: string, chainId: number) {
	return observations.filter(observation => observation.chainId === chainId && observation.assetId.toLowerCase() === assetId.toLowerCase())
}

export async function clearOrphanedDexEvidenceForHeadReplacement(
	previous: { hash: string | undefined; number: bigint | undefined },
	current: { hash: string; number: bigint },
	evidence: { marketConsensus?: unknown | undefined; marketConsensusByAsset?: Map<string, unknown> | undefined; marketObservations?: MarketConsensusObservation[] | undefined },
	readCanonicalHash: (blockNumber: bigint) => Promise<string | undefined>,
) {
	if (previous.number === undefined || previous.hash === undefined) return false
	const clearEvidence = () => {
		evidence.marketObservations = discardDexMarketObservations(evidence.marketObservations ?? [])
		evidence.marketConsensus = undefined
		evidence.marketConsensusByAsset?.clear()
	}
	if (current.number < previous.number) {
		clearEvidence()
		return true
	}
	let canonicalPreviousHash: string | undefined
	try {
		canonicalPreviousHash = previous.number === current.number ? current.hash : await readCanonicalHash(previous.number)
	} catch (error) {
		clearEvidence()
		throw error
	}
	if (canonicalPreviousHash !== undefined && canonicalPreviousHash.toLowerCase() === previous.hash.toLowerCase()) return false
	clearEvidence()
	return true
}

export type MarketVenueKind = 'cex' | 'dex'

export type MarketConsensusObservation = {
	assetId: string
	askDepthEth: bigint
	bidDepthEth: bigint
	blockHash?: `0x${string}` | undefined
	blockNumber?: bigint | undefined
	chainId: number
	kind: MarketVenueKind
	marketId?: string
	observationId: string
	observedAt: number
	priceRepPerEth: bigint
	sourceId: string
}

export async function requireCanonicalDexEvidence(estimate: MarketConsensusEstimate | undefined, readCanonicalHash: (blockNumber: bigint) => Promise<`0x${string}` | undefined>) {
	if (estimate === undefined || !estimate.dex.reliable) return
	const identities = new Map<bigint, `0x${string}`>()
	for (const observation of estimate.dex.observations) {
		if (observation.blockNumber === undefined || observation.blockHash === undefined) throw new Error('DEX market evidence is missing canonical block identity')
		const existing = identities.get(observation.blockNumber)
		if (existing !== undefined && existing.toLowerCase() !== observation.blockHash.toLowerCase()) throw new Error('DEX market evidence contains conflicting canonical block identities')
		identities.set(observation.blockNumber, observation.blockHash)
	}
	for (const [blockNumber, blockHash] of identities) await requireCanonicalBlock(blockNumber, blockHash, readCanonicalHash)
}

export type MarketConsensusSettings = {
	allowSingleGroupFallback: boolean
	maximumGroupDeviationBps: bigint
	maximumObservationAgeMilliseconds: number
	maximumVenueDispersionBps: bigint
	minimumAskDepthEthPerSource: bigint
	minimumBidDepthEthPerSource: bigint
	minimumCexAskDepthEth: bigint
	minimumCexBidDepthEth: bigint
	minimumCexSourceCount: number
	minimumDexSourceCount: number
	minimumSourceObservationCount: number
	minimumSourceObservationSpanMilliseconds: number
	minimumTotalSourceCount: number
}

export type MarketGroupEstimate = {
	askDepthEth: bigint
	bidDepthEth: bigint
	kind: MarketVenueKind
	maximumPriceRepPerEth: bigint
	minimumPriceRepPerEth: bigint
	observations: readonly MarketConsensusObservation[]
	priceRepPerEth: bigint
	reliable: boolean
	reasons: readonly string[]
}

export type MarketConsensusEstimate = {
	assetId: string
	cex: MarketGroupEstimate
	chainId: number
	dex: MarketGroupEstimate
	priceRepPerEth: bigint | undefined
	reliable: boolean
	reasons: readonly string[]
	sourceCount: number
}

function median(values: readonly bigint[]) {
	if (values.length === 0) return undefined
	const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
	const middle = Math.floor(sorted.length / 2)
	const upper = sorted[middle]
	if (upper === undefined) return undefined
	if (sorted.length % 2 === 1) return upper
	const lower = sorted[middle - 1]
	return lower === undefined ? undefined : (lower + upper) / 2n
}

function deviationBps(left: bigint, right: bigint) {
	if (left <= 0n || right <= 0n) return BPS
	const distance = left > right ? left - right : right - left
	return (distance * BPS) / right
}

function latestIndependentSources(observations: readonly MarketConsensusObservation[], now: number, maximumAge: number, excludedSourceId?: string, excludedMarketId?: string) {
	const histories = new Map<string, MarketConsensusObservation[]>()
	for (const observation of observations) {
		if (observation.priceRepPerEth <= 0n || observation.observedAt > now || now - observation.observedAt > maximumAge) continue
		if (excludedSourceId !== undefined && observation.sourceId.toLowerCase() === excludedSourceId.toLowerCase()) continue
		if (excludedMarketId !== undefined && observation.marketId?.toLowerCase() === excludedMarketId.toLowerCase()) continue
		const key = observation.sourceId.toLowerCase()
		const history = histories.get(key) ?? []
		history.push(observation)
		histories.set(key, history)
	}
	return histories
}

function canonicalObservation(bucket: readonly MarketConsensusObservation[]) {
	const maximumDepth = bucket.reduce((maximum, observation) => {
		const depth = observation.askDepthEth < observation.bidDepthEth ? observation.askDepthEth : observation.bidDepthEth
		return depth > maximum ? depth : maximum
	}, -1n)
	const strongest = bucket.filter(observation => (observation.askDepthEth < observation.bidDepthEth ? observation.askDepthEth : observation.bidDepthEth) === maximumDepth)
	const prices = new Set(strongest.map(observation => observation.priceRepPerEth))
	const canonical = strongest[0]
	if (prices.size !== 1 || canonical === undefined) return undefined
	return {
		...canonical,
		askDepthEth: strongest.reduce((minimum, observation) => (observation.askDepthEth < minimum ? observation.askDepthEth : minimum), canonical.askDepthEth),
		bidDepthEth: strongest.reduce((minimum, observation) => (observation.bidDepthEth < minimum ? observation.bidDepthEth : minimum), canonical.bidDepthEth),
	}
}

function persistentLatestSources(observations: readonly MarketConsensusObservation[], settings: MarketConsensusSettings, now: number, excludedSourceId?: string, excludedMarketId?: string) {
	const histories = latestIndependentSources(observations, now, settings.maximumObservationAgeMilliseconds, excludedSourceId, excludedMarketId)
	const latest: MarketConsensusObservation[] = []
	for (const history of histories.values()) {
		const identityBuckets = new Map<string, MarketConsensusObservation[]>()
		for (const observation of history) {
			const bucket = identityBuckets.get(observation.observationId) ?? []
			bucket.push(observation)
			identityBuckets.set(observation.observationId, bucket)
		}
		const identityTimeline: MarketConsensusObservation[] = []
		let ambiguousIdentity = false
		for (const bucket of identityBuckets.values()) {
			const canonical = canonicalObservation(bucket)
			if (canonical === undefined) {
				ambiguousIdentity = true
				break
			}
			identityTimeline.push(canonical)
		}
		if (ambiguousIdentity) continue
		const timestampBuckets = new Map<number, MarketConsensusObservation[]>()
		for (const observation of identityTimeline) {
			const bucket = timestampBuckets.get(observation.observedAt) ?? []
			bucket.push(observation)
			timestampBuckets.set(observation.observedAt, bucket)
		}
		const timeline: MarketConsensusObservation[] = []
		let ambiguousTimestamp = false
		for (const bucket of timestampBuckets.values()) {
			const canonical = canonicalObservation(bucket)
			if (canonical === undefined) {
				ambiguousTimestamp = true
				break
			}
			timeline.push(canonical)
		}
		if (ambiguousTimestamp) continue
		timeline.sort((left, right) => left.observedAt - right.observedAt)
		const selected = timeline.at(-1)
		if (selected === undefined) continue
		const persistentPriceRegime: MarketConsensusObservation[] = []
		for (let index = timeline.length - 1; index >= 0; index -= 1) {
			const observation = timeline[index]
			if (observation === undefined || deviationBps(observation.priceRepPerEth, selected.priceRepPerEth) > settings.maximumVenueDispersionBps) break
			persistentPriceRegime.unshift(observation)
		}
		const first = persistentPriceRegime[0]
		if (first === undefined || persistentPriceRegime.length < settings.minimumSourceObservationCount || selected.observedAt - first.observedAt < settings.minimumSourceObservationSpanMilliseconds) continue
		latest.push(selected)
	}
	return latest
}

function groupEstimate(kind: MarketVenueKind, observations: readonly MarketConsensusObservation[], settings: MarketConsensusSettings, minimumSources: number): MarketGroupEstimate {
	const reasons: string[] = []
	const prices = observations.map(observation => observation.priceRepPerEth)
	const priceRepPerEth = median(prices) ?? 0n
	const minimumPriceRepPerEth = prices.reduce((minimum, price) => (price < minimum ? price : minimum), prices[0] ?? 0n)
	const maximumPriceRepPerEth = prices.reduce((maximum, price) => (price > maximum ? price : maximum), prices[0] ?? 0n)
	if (observations.length < minimumSources) reasons.push(`Only ${observations.length.toString()} independent ${kind.toUpperCase()} source(s); ${minimumSources.toString()} required`)
	if (priceRepPerEth > 0n && deviationBps(maximumPriceRepPerEth, minimumPriceRepPerEth) > settings.maximumVenueDispersionBps) reasons.push(`${kind.toUpperCase()} venue dispersion exceeds the configured limit`)
	const bidDepthEth = observations.reduce((total, observation) => total + observation.bidDepthEth, 0n)
	const askDepthEth = observations.reduce((total, observation) => total + observation.askDepthEth, 0n)
	if (kind === 'dex' && observations.some(observation => observation.bidDepthEth < settings.minimumBidDepthEthPerSource)) reasons.push('DEX bid depth is below the per-source minimum')
	if (kind === 'dex' && observations.some(observation => observation.askDepthEth < settings.minimumAskDepthEthPerSource)) reasons.push('DEX ask depth is below the per-source minimum')
	if (kind === 'cex' && bidDepthEth < settings.minimumCexBidDepthEth) reasons.push('CEX bid depth is below the configured minimum')
	if (kind === 'cex' && askDepthEth < settings.minimumCexAskDepthEth) reasons.push('CEX ask depth is below the configured minimum')
	return {
		askDepthEth,
		bidDepthEth,
		kind,
		maximumPriceRepPerEth,
		minimumPriceRepPerEth,
		observations,
		priceRepPerEth,
		reasons,
		reliable: reasons.length === 0,
	}
}

export function estimateMarketConsensus(observations: readonly MarketConsensusObservation[], settings: MarketConsensusSettings, assetId: string, chainId: number, now = Date.now(), excludedDexSourceId?: string, excludedDexMarketId?: string): MarketConsensusEstimate {
	if (observations.some(observation => observation.assetId.toLowerCase() !== assetId.toLowerCase() || observation.chainId !== chainId)) throw new Error('Market consensus observations must describe one exact REP asset and chain')
	const cex = groupEstimate(
		'cex',
		persistentLatestSources(
			observations.filter(observation => observation.kind === 'cex'),
			settings,
			now,
		),
		settings,
		settings.minimumCexSourceCount,
	)
	const dex = groupEstimate(
		'dex',
		persistentLatestSources(
			observations.filter(observation => observation.kind === 'dex'),
			settings,
			now,
			excludedDexSourceId,
			excludedDexMarketId,
		),
		settings,
		settings.minimumDexSourceCount,
	)
	const reasons = [...cex.reasons, ...dex.reasons]
	let priceRepPerEth: bigint | undefined
	let supportingObservations: readonly MarketConsensusObservation[] = []
	if (cex.reliable && dex.reliable) {
		if (deviationBps(cex.priceRepPerEth, dex.priceRepPerEth) > settings.maximumGroupDeviationBps) reasons.push('CEX and DEX consensus groups disagree')
		else {
			priceRepPerEth = median([cex.priceRepPerEth, dex.priceRepPerEth])
			supportingObservations = [...cex.observations, ...dex.observations]
		}
	} else if (settings.allowSingleGroupFallback && cex.reliable) {
		priceRepPerEth = cex.priceRepPerEth
		supportingObservations = cex.observations
	} else if (settings.allowSingleGroupFallback && dex.reliable) {
		priceRepPerEth = dex.priceRepPerEth
		supportingObservations = dex.observations
	}
	const cexSourceIds = new Set(cex.observations.map(observation => observation.sourceId.toLowerCase()))
	if (dex.observations.some(observation => cexSourceIds.has(observation.sourceId.toLowerCase()))) reasons.push('A failure-domain source ID is reused across CEX and DEX')
	const sourceCount = new Set(supportingObservations.map(observation => observation.sourceId.toLowerCase())).size
	if (sourceCount < settings.minimumTotalSourceCount) reasons.push(`Only ${sourceCount.toString()} total independent sources; ${settings.minimumTotalSourceCount.toString()} required`)
	return {
		assetId,
		cex,
		chainId,
		dex,
		priceRepPerEth,
		reasons,
		reliable: priceRepPerEth !== undefined && sourceCount >= settings.minimumTotalSourceCount && !reasons.includes('CEX and DEX consensus groups disagree') && !reasons.includes('A failure-domain source ID is reused across CEX and DEX'),
		sourceCount,
	}
}

export function consensusAllowsCandidate(candidatePriceRepPerEth: bigint, estimate: MarketConsensusEstimate, maximumDeviationBps: bigint) {
	if (!estimate.reliable || estimate.priceRepPerEth === undefined || candidatePriceRepPerEth <= 0n) return false
	return deviationBps(candidatePriceRepPerEth, estimate.priceRepPerEth) <= maximumDeviationBps
}

export function marketConsensusAllowsExecution(candidatePriceRepPerEth: bigint, estimate: MarketConsensusEstimate | undefined, settings: { maximumDeviationBps: bigint; maximumObservationAgeMilliseconds: number; requiredForExecution: boolean }, assetId: string, chainId: number, now = Date.now()) {
	const supportingObservations = estimate === undefined ? [] : [...(estimate.cex.reliable ? estimate.cex.observations : []), ...(estimate.dex.reliable ? estimate.dex.observations : [])]
	const fresh = supportingObservations.length > 0 && supportingObservations.every(observation => observation.observedAt <= now && now - observation.observedAt <= settings.maximumObservationAgeMilliseconds)
	if (estimate === undefined || estimate.assetId.toLowerCase() !== assetId.toLowerCase() || estimate.chainId !== chainId || !estimate.reliable || !fresh) return !settings.requiredForExecution
	return consensusAllowsCandidate(candidatePriceRepPerEth, estimate, settings.maximumDeviationBps)
}

export function marketConsensusDeviationBps(candidatePriceRepPerEth: bigint, estimate: MarketConsensusEstimate | undefined, assetId: string) {
	if (estimate === undefined || estimate.assetId.toLowerCase() !== assetId.toLowerCase() || estimate.priceRepPerEth === undefined || candidatePriceRepPerEth <= 0n) return undefined
	return deviationBps(candidatePriceRepPerEth, estimate.priceRepPerEth)
}

export function serializeMarketConsensusEstimate(estimate: MarketConsensusEstimate | undefined, format: (value: bigint) => string) {
	if (estimate === undefined) return undefined
	const group = (value: MarketGroupEstimate) => ({
		askDepthEth: format(value.askDepthEth),
		bidDepthEth: format(value.bidDepthEth),
		priceRepPerEth: format(value.priceRepPerEth),
		reasons: value.reasons,
		reliable: value.reliable,
		sourceCount: value.observations.length,
	})
	return {
		assetId: estimate.assetId,
		cex: group(estimate.cex),
		chainId: estimate.chainId,
		dex: group(estimate.dex),
		priceRepPerEth: estimate.priceRepPerEth === undefined ? undefined : format(estimate.priceRepPerEth),
		reasons: estimate.reasons,
		reliable: estimate.reliable,
		sourceCount: estimate.sourceCount,
	}
}
