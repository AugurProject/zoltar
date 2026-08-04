import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { useRequestGuard } from '../../../lib/requestGuard.js'
import { getActiveBackend } from '../../../lib/activeEnvironment.js'
import type { ChainBackend } from '../../../lib/chainBackend.js'
import { isRecoverableQuoteError } from '../../../lib/errors.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource, ETH_ADDRESS, getRepAddress, isRepPricingEnabled } from '../../../protocol/uniswapQuoter.js'
import type { RepPriceFailure } from '../../types.js'

const ONE_ETH = 10n ** 18n
const ONE_REP = 10n ** 18n
const REP_PRICE_CACHE_TTL_MILLISECONDS = 30_000

type PriceSource = 'v4' | 'v3' | 'mock'

type RepPrices = {
	repPerEthPrice: bigint | undefined // REP in wei-style token units received for 1 ETH
	repPerEthFailure: RepPriceFailure | undefined
	repPerEthSource: PriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
	repUsdcFailure: RepPriceFailure | undefined
	repUsdcSource: PriceSource | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
	isRefreshingRepPrices: boolean
	refreshRepPrices: () => void
}

type CachedRepPrices = {
	repPerEthCachedAtMs: number | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: PriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcCachedAtMs: number | undefined
	repUsdcPrice: bigint | undefined
	repUsdcSource: PriceSource | undefined
	repUsdcSourceUrl: string | undefined
}

type RepPriceLoadResult = {
	prices: CachedRepPrices | undefined
	repPerEthFailure: RepPriceFailure | undefined
	repUsdcFailure: RepPriceFailure | undefined
}

type UseRepPricesOptions = {
	enabled?: boolean
}

const repPriceCacheByBackend = new Map<ChainBackend, CachedRepPrices>()
const repPriceRefreshByBackend = new Map<ChainBackend, Promise<RepPriceLoadResult>>()
const repPriceRefreshGenerationByBackend = new Map<ChainBackend, number>()

function getCachedRepPrices(backend: ChainBackend) {
	return repPriceCacheByBackend.get(backend)
}

function getFreshCachedRepPrices(backend: ChainBackend) {
	const cachedRepPrices = getCachedRepPrices(backend)
	if (cachedRepPrices === undefined) return undefined
	const now = Date.now()
	if (cachedRepPrices.repPerEthCachedAtMs === undefined || now - cachedRepPrices.repPerEthCachedAtMs >= REP_PRICE_CACHE_TTL_MILLISECONDS) return undefined
	if (backend.profile.repPricingMode !== 'unavailable' && (cachedRepPrices.repUsdcCachedAtMs === undefined || now - cachedRepPrices.repUsdcCachedAtMs >= REP_PRICE_CACHE_TTL_MILLISECONDS)) return undefined
	return cachedRepPrices
}

function getNextRepPriceExpiry(cachedRepPrices: CachedRepPrices | undefined, backend: ChainBackend) {
	if (cachedRepPrices === undefined) return undefined
	const cachedAtValues = [cachedRepPrices.repPerEthCachedAtMs, backend.profile.repPricingMode === 'unavailable' ? undefined : cachedRepPrices.repUsdcCachedAtMs].filter(value => value !== undefined)
	if (cachedAtValues.length === 0) return undefined
	return Math.min(...cachedAtValues) + REP_PRICE_CACHE_TTL_MILLISECONDS
}

export function resetRepPriceCacheForTesting() {
	repPriceCacheByBackend.clear()
	repPriceRefreshByBackend.clear()
	repPriceRefreshGenerationByBackend.clear()
}

async function fetchRepPerEthPrice(client: ReturnType<ChainBackend['createReadClient']>): Promise<{ price: bigint; source: PriceSource; sourceUrl: string | undefined }> {
	const repAddress = getRepAddress()
	try {
		const { amountOut, source } = await quoteBestExactInputWithSource(client, ETH_ADDRESS, repAddress, ONE_ETH)
		return { price: amountOut, source: source.protocol === 'mock' ? 'mock' : 'v4', sourceUrl: source.poolUrl }
	} catch (error) {
		if (!isRecoverableQuoteError(error)) throw error
		// V4 REP/ETH pool doesn't exist yet — fall back to V3 WETH/REP (1% pool)
		const { amountOut, source } = await quoteBestV3ExactInputWithSource(client, ETH_ADDRESS, repAddress, ONE_ETH)
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

async function loadRepPrices(backend: ChainBackend, forceRefresh: boolean) {
	const cachedRepPrices = forceRefresh ? undefined : getFreshCachedRepPrices(backend)
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
		const [repPerEthResult, repUsdcResult] = await Promise.allSettled([fetchRepPerEthPrice(client), quoteRepForUsdcV4WithSource(client, ONE_REP)])
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

		if (repUsdcResult.status === 'fulfilled') {
			nextCachedRepPrices.repUsdcCachedAtMs = Date.now()
			nextCachedRepPrices.repUsdcPrice = repUsdcResult.value.amountOut
			nextCachedRepPrices.repUsdcSource = repUsdcResult.value.source.protocol === 'mock' ? 'mock' : 'v4'
			nextCachedRepPrices.repUsdcSourceUrl = repUsdcResult.value.source.poolUrl
			hasNextCachedRepPrices = true
		} else if (!isRepPricingEnabled()) {
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

export function useRepPrices({ enabled = true }: UseRepPricesOptions = {}): RepPrices {
	const backend = getActiveBackend()
	const cachedRepPrices = getFreshCachedRepPrices(backend)
	const displayedBackend = useRef(backend)
	const repPerEthPrice = useSignal<bigint | undefined>(cachedRepPrices?.repPerEthPrice)
	const repPerEthFailure = useSignal<RepPriceFailure | undefined>(undefined)
	const repPerEthSource = useSignal<PriceSource | undefined>(cachedRepPrices?.repPerEthSource)
	const repPerEthSourceUrl = useSignal<string | undefined>(cachedRepPrices?.repPerEthSourceUrl)
	const repUsdcPrice = useSignal<bigint | undefined>(cachedRepPrices?.repUsdcPrice)
	const repUsdcFailure = useSignal<RepPriceFailure | undefined>(undefined)
	const repUsdcSource = useSignal<PriceSource | undefined>(cachedRepPrices?.repUsdcSource)
	const repUsdcSourceUrl = useSignal<string | undefined>(cachedRepPrices?.repUsdcSourceUrl)
	const repPricesLoad = useLoadController()
	const nextRepPricesLoad = useRequestGuard()
	const cacheExpiry = useSignal<number | undefined>(getNextRepPriceExpiry(cachedRepPrices, backend))
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
		cacheExpiry.value = getNextRepPriceExpiry(result.prices, backend)
	}

	const refreshRepPricesInternal = (forceRefresh: boolean) => {
		const isCurrent = nextRepPricesLoad()
		const nextFreshCachedRepPrices = forceRefresh ? undefined : getFreshCachedRepPrices(backend)
		if (nextFreshCachedRepPrices !== undefined) {
			applyRepPriceLoadResult({
				prices: nextFreshCachedRepPrices,
				repPerEthFailure: undefined,
				repUsdcFailure: undefined,
			})
			return
		}

		void repPricesLoad
			.track(async () => {
				const result = await loadRepPrices(backend, forceRefresh)
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

	const refreshRepPrices = () => {
		if (getActiveBackend() !== backend) return
		refreshRepPricesInternal(true)
	}

	useEffect(() => {
		if (!enabled) return
		const nextCachedRepPrices = getFreshCachedRepPrices(backend)
		applyRepPriceLoadResult({
			prices: nextCachedRepPrices,
			repPerEthFailure: undefined,
			repUsdcFailure: undefined,
		})
		refreshRepPricesInternal(false)
	}, [backend, enabled])

	useEffect(() => {
		if (!enabled || cacheExpiry.value === undefined) return
		const delay = Math.max(0, cacheExpiry.value - Date.now())
		const timeout = window.setTimeout(() => {
			applyRepPriceLoadResult({ prices: undefined, repPerEthFailure: undefined, repUsdcFailure: undefined })
			refreshRepPricesInternal(true)
		}, delay)
		return () => window.clearTimeout(timeout)
	}, [backend, cacheExpiry.value, enabled])

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
