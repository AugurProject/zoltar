import { useSignal } from '@preact/signals'
import { repPriceRefreshTimeout, repQuoteTimeout } from '../../../copy/openOracle.js'
import { useEffect, useRef } from 'preact/hooks'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { isRecoverableQuoteError } from '@zoltar/ui-core-shared/lib/errors.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource, ETH_ADDRESS, getRepAddress, isRepPricingEnabled } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'

type RepPriceQuoter = {
	getRepAddress: typeof getRepAddress
	isRepPricingEnabled: typeof isRepPricingEnabled
	quoteBestExactInputWithSource: typeof quoteBestExactInputWithSource
	quoteBestV3ExactInputWithSource: typeof quoteBestV3ExactInputWithSource
	quoteRepForUsdcV4WithSource: typeof quoteRepForUsdcV4WithSource
}

/** @internal */
export function installRepPriceQuoterForTesting(quoter: RepPriceQuoter | undefined) {
	globalThis.__zoltarRepPriceQuoterOverride__ = quoter
}

declare global {
	var __zoltarRepPriceQuoterOverride__: RepPriceQuoter | undefined
}

function getRepPriceQuoter(): RepPriceQuoter {
	return globalThis.__zoltarRepPriceQuoterOverride__ ?? { getRepAddress, isRepPricingEnabled, quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource }
}
import type { RepPriceFailure, RepPriceSource } from '@zoltar/ui-core-shared/lib/repPriceSource.js'

const ATTO_ETH_PER_ETH = 10n ** 18n
const ATTO_REP = 10n ** 18n
const REP_PRICE_CACHE_TTL_MILLISECONDS = 30_000

type RepPrices = {
	repPerEthPrice: bigint | undefined // REP in attoETH-style token units received for 1 ETH
	repPerEthFailure: RepPriceFailure | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
	repUsdcFailure: RepPriceFailure | undefined
	repUsdcSource: RepPriceSource | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
	isRefreshingRepPrices: boolean
	refreshRepPrices: () => Promise<void>
}

type CachedRepPrices = {
	repPerEthCachedAtMs: number | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcCachedAtMs: number | undefined
	repUsdcPrice: bigint | undefined
	repUsdcSource: RepPriceSource | undefined
	repUsdcSourceUrl: string | undefined
}

type RepPriceLoadResult = {
	prices: CachedRepPrices | undefined
	repPerEthFailure: RepPriceFailure | undefined
	repUsdcFailure: RepPriceFailure | undefined
}

type UseRepPricesOptions = {
	enabled?: boolean
	headerOnly?: boolean
}

const repPriceCacheByBackend = new Map<ChainBackend, CachedRepPrices>()
const repPriceRefreshByBackend = new Map<ChainBackend, Promise<RepPriceLoadResult>>()
const repPriceRefreshGenerationByBackend = new Map<ChainBackend, number>()

function getCachedRepPrices(backend: ChainBackend) {
	return repPriceCacheByBackend.get(backend)
}

function getFreshCachedRepPrices(backend: ChainBackend, headerOnly: boolean) {
	const cachedRepPrices = getCachedRepPrices(backend)
	if (cachedRepPrices === undefined) return undefined
	const now = Date.now()
	if (cachedRepPrices.repPerEthCachedAtMs === undefined || now - cachedRepPrices.repPerEthCachedAtMs >= REP_PRICE_CACHE_TTL_MILLISECONDS) return undefined
	if (!headerOnly && backend.profile.repPricingMode !== 'unavailable' && (cachedRepPrices.repUsdcCachedAtMs === undefined || now - cachedRepPrices.repUsdcCachedAtMs >= REP_PRICE_CACHE_TTL_MILLISECONDS)) return undefined
	return cachedRepPrices
}

/** @internal */
export function resetRepPriceCacheForTesting() {
	repPriceCacheByBackend.clear()
	repPriceRefreshByBackend.clear()
	repPriceRefreshGenerationByBackend.clear()
}

async function fetchRepPerEthPrice(client: ReturnType<ChainBackend['createReadClient']>): Promise<{ price: bigint; source: RepPriceSource; sourceUrl: string | undefined }> {
	const quoter = getRepPriceQuoter()
	const repAddress = quoter.getRepAddress()
	try {
		const { amountOut, source } = await withTimeout(quoter.quoteBestExactInputWithSource(client, ETH_ADDRESS, repAddress, ATTO_ETH_PER_ETH), 30_000, repQuoteTimeout('V4'))
		return { price: amountOut, source: source.protocol === 'mock' ? 'mock' : 'v4', sourceUrl: source.poolUrl }
	} catch (error) {
		if (!isRecoverableQuoteError(error)) throw error
		// Missing or stalled V4 quotes must still allow a bounded V3 fallback.
		const { amountOut, source } = await withTimeout(quoter.quoteBestV3ExactInputWithSource(client, ETH_ADDRESS, repAddress, ATTO_ETH_PER_ETH), 30_000, repQuoteTimeout('V3'))
		return { price: amountOut, source: source.protocol === 'mock' ? 'mock' : 'v3', sourceUrl: source.poolUrl }
	}
}

function classifyRepPriceFailure(error: unknown): RepPriceFailure {
	if (!(error instanceof Error)) return 'no-liquidity'
	const transportErrorNames = ['HttpRequestError', 'RpcError', 'RpcRequestError', 'TimeoutError', 'UnknownNodeError']
	if (transportErrorNames.includes(error.name)) return 'rpc-error'
	if (/\b(connection|fetch|http|network|rpc|timeout)\b/i.test(error.message)) return 'rpc-error'
	return 'no-liquidity'
}

async function loadRepPrices(backend: ChainBackend, forceRefresh: boolean, headerOnly: boolean) {
	const cachedRepPrices = forceRefresh ? undefined : getFreshCachedRepPrices(backend, headerOnly)
	if (cachedRepPrices !== undefined) {
		return {
			prices: cachedRepPrices,
			repPerEthFailure: undefined,
			repUsdcFailure: undefined,
		}
	}

	const pendingRefresh = repPriceRefreshByBackend.get(backend)
	if (!forceRefresh && pendingRefresh !== undefined) return await pendingRefresh

	const refreshGeneration = (repPriceRefreshGenerationByBackend.get(backend) ?? 0) + 1
	repPriceRefreshGenerationByBackend.set(backend, refreshGeneration)
	const refreshPromise = (async () => {
		const client = backend.createReadClient()
		const [repPerEthResult, repUsdcResult] = await Promise.allSettled([fetchRepPerEthPrice(client), headerOnly ? undefined : withTimeout(getRepPriceQuoter().quoteRepForUsdcV4WithSource(client, ATTO_REP), 30_000, repPriceRefreshTimeout)])
		if (repPerEthResult.status === 'rejected' && !isRecoverableQuoteError(repPerEthResult.reason)) throw repPerEthResult.reason
		if (repUsdcResult.status === 'rejected' && !isRecoverableQuoteError(repUsdcResult.reason)) throw repUsdcResult.reason
		const nextCachedRepPrices: CachedRepPrices = {
			repPerEthCachedAtMs: undefined,
			repPerEthPrice: undefined,
			repPerEthSource: undefined,
			repPerEthSourceUrl: undefined,
			repUsdcCachedAtMs: undefined,
			repUsdcPrice: undefined,
			repUsdcSource: undefined,
			repUsdcSourceUrl: undefined,
		}
		let hasNextCachedRepPrices = false

		if (repPerEthResult.status === 'fulfilled') {
			nextCachedRepPrices.repPerEthCachedAtMs = Date.now()
			nextCachedRepPrices.repPerEthPrice = repPerEthResult.value.price
			nextCachedRepPrices.repPerEthSource = repPerEthResult.value.source
			nextCachedRepPrices.repPerEthSourceUrl = repPerEthResult.value.sourceUrl
			hasNextCachedRepPrices = true
		}

		if (repUsdcResult.status === 'fulfilled' && repUsdcResult.value !== undefined) {
			nextCachedRepPrices.repUsdcCachedAtMs = Date.now()
			nextCachedRepPrices.repUsdcPrice = repUsdcResult.value.amountOut
			nextCachedRepPrices.repUsdcSource = repUsdcResult.value.source.protocol === 'mock' ? 'mock' : 'v4'
			nextCachedRepPrices.repUsdcSourceUrl = repUsdcResult.value.source.poolUrl
			hasNextCachedRepPrices = true
		} else if (!getRepPriceQuoter().isRepPricingEnabled()) {
			nextCachedRepPrices.repUsdcCachedAtMs = Date.now()
			nextCachedRepPrices.repUsdcPrice = undefined
			nextCachedRepPrices.repUsdcSource = undefined
			nextCachedRepPrices.repUsdcSourceUrl = undefined
			hasNextCachedRepPrices = true
		}

		const failures = {
			repPerEthFailure: repPerEthResult.status === 'rejected' ? classifyRepPriceFailure(repPerEthResult.reason) : undefined,
			repUsdcFailure: repUsdcResult.status === 'rejected' ? classifyRepPriceFailure(repUsdcResult.reason) : undefined,
		}
		if (repPriceRefreshGenerationByBackend.get(backend) !== refreshGeneration) {
			return {
				prices: getCachedRepPrices(backend),
				repPerEthFailure: undefined,
				repUsdcFailure: undefined,
			}
		}
		if (!hasNextCachedRepPrices) {
			repPriceCacheByBackend.delete(backend)
			return { prices: undefined, ...failures }
		}
		repPriceCacheByBackend.set(backend, nextCachedRepPrices)
		return { prices: nextCachedRepPrices, ...failures }
	})()

	repPriceRefreshByBackend.set(backend, refreshPromise)

	try {
		return await refreshPromise
	} finally {
		if (repPriceRefreshByBackend.get(backend) === refreshPromise) {
			repPriceRefreshByBackend.delete(backend)
		}
	}
}

export function useRepPrices({ enabled = true, headerOnly = false }: UseRepPricesOptions = {}): RepPrices {
	const backend = getActiveBackend()
	const cachedRepPrices = getCachedRepPrices(backend)
	const displayedBackend = useRef(backend)
	const repPerEthPrice = useSignal<bigint | undefined>(cachedRepPrices?.repPerEthPrice)
	const repPerEthFailure = useSignal<RepPriceFailure | undefined>(undefined)
	const repPerEthSource = useSignal<RepPriceSource | undefined>(cachedRepPrices?.repPerEthSource)
	const repPerEthSourceUrl = useSignal<string | undefined>(cachedRepPrices?.repPerEthSourceUrl)
	const repUsdcPrice = useSignal<bigint | undefined>(cachedRepPrices?.repUsdcPrice)
	const repUsdcFailure = useSignal<RepPriceFailure | undefined>(undefined)
	const repUsdcSource = useSignal<RepPriceSource | undefined>(cachedRepPrices?.repUsdcSource)
	const repUsdcSourceUrl = useSignal<string | undefined>(cachedRepPrices?.repUsdcSourceUrl)
	const repPricesLoad = useLoadController()
	const nextRepPricesLoad = useRequestGuard()
	const applyRepPriceLoadResult = (result: RepPriceLoadResult) => {
		displayedBackend.current = backend
		repPerEthFailure.value = result.repPerEthFailure
		repUsdcFailure.value = result.repUsdcFailure
		repPerEthPrice.value = result.prices?.repPerEthPrice
		repPerEthSource.value = result.prices?.repPerEthSource
		repPerEthSourceUrl.value = result.prices?.repPerEthSourceUrl
		repUsdcPrice.value = result.prices?.repUsdcPrice
		repUsdcSource.value = result.prices?.repUsdcSource
		repUsdcSourceUrl.value = result.prices?.repUsdcSourceUrl
	}

	const refreshRepPricesInternal = async (forceRefresh: boolean) => {
		if (document.hidden) return
		const isCurrent = nextRepPricesLoad()
		const nextFreshCachedRepPrices = forceRefresh ? undefined : getFreshCachedRepPrices(backend, headerOnly)
		if (nextFreshCachedRepPrices !== undefined) {
			applyRepPriceLoadResult({
				prices: nextFreshCachedRepPrices,
				repPerEthFailure: undefined,
				repUsdcFailure: undefined,
			})
			return
		}

		await repPricesLoad
			.track(async () => {
				const result = await loadRepPrices(backend, forceRefresh, headerOnly)
				if (!isCurrent()) return
				applyRepPriceLoadResult(result)
			})
			.catch(error => {
				if (!isRecoverableQuoteError(error)) throw error
				if (!isCurrent()) return
				const failure = classifyRepPriceFailure(error)
				applyRepPriceLoadResult({ prices: undefined, repPerEthFailure: failure, repUsdcFailure: failure })
			})
	}

	const refreshRepPrices = async () => {
		if (getActiveBackend() !== backend || repPricesLoad.isLoading.value) return
		await refreshRepPricesInternal(true)
	}

	useEffect(() => {
		if (!enabled) return
		const nextCachedRepPrices = getCachedRepPrices(backend)
		applyRepPriceLoadResult({
			prices: nextCachedRepPrices,
			repPerEthFailure: undefined,
			repUsdcFailure: undefined,
		})
		void refreshRepPricesInternal(false)
	}, [backend, enabled, headerOnly])

	const pricesMatchBackend = displayedBackend.current === backend
	const currentRepPerEthPrice = pricesMatchBackend ? repPerEthPrice.value : undefined
	const currentRepUsdcPrice = pricesMatchBackend ? repUsdcPrice.value : undefined
	const hasLoadedRepPrices = currentRepPerEthPrice !== undefined || currentRepUsdcPrice !== undefined

	return {
		isLoadingRepPrices: repPricesLoad.isLoading.value && !hasLoadedRepPrices,
		isRefreshingRepPrices: repPricesLoad.isLoading.value,
		repPerEthFailure: pricesMatchBackend ? repPerEthFailure.value : undefined,
		repPerEthPrice: currentRepPerEthPrice,
		repPerEthSource: pricesMatchBackend ? repPerEthSource.value : undefined,
		repPerEthSourceUrl: pricesMatchBackend ? repPerEthSourceUrl.value : undefined,
		repUsdcFailure: pricesMatchBackend ? repUsdcFailure.value : undefined,
		repUsdcPrice: currentRepUsdcPrice,
		repUsdcSource: pricesMatchBackend ? repUsdcSource.value : undefined,
		repUsdcSourceUrl: pricesMatchBackend ? repUsdcSourceUrl.value : undefined,
		refreshRepPrices,
	}
}
