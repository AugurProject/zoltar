import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
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
	cachedAtMs: number
	repPerEthPrice: bigint | undefined
	repPerEthSource: PriceSource | undefined
	repPerEthSourceUrl: string | undefined
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
	if (Date.now() - cachedRepPrices.cachedAtMs > REP_PRICE_CACHE_TTL_MILLISECONDS) return undefined
	return cachedRepPrices
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
			cachedAtMs: Date.now(),
			repPerEthPrice: getCachedRepPrices(backend)?.repPerEthPrice,
			repPerEthSource: getCachedRepPrices(backend)?.repPerEthSource,
			repPerEthSourceUrl: getCachedRepPrices(backend)?.repPerEthSourceUrl,
			repUsdcPrice: getCachedRepPrices(backend)?.repUsdcPrice,
			repUsdcSource: getCachedRepPrices(backend)?.repUsdcSource,
			repUsdcSourceUrl: getCachedRepPrices(backend)?.repUsdcSourceUrl,
		}
		let hasNextCachedRepPrices = false

		if (repPerEthResult.status === 'fulfilled') {
			nextCachedRepPrices.repPerEthPrice = repPerEthResult.value.price
			nextCachedRepPrices.repPerEthSource = repPerEthResult.value.source
			nextCachedRepPrices.repPerEthSourceUrl = repPerEthResult.value.sourceUrl
			hasNextCachedRepPrices = true
		}

		if (repUsdcResult.status === 'fulfilled') {
			nextCachedRepPrices.repUsdcPrice = repUsdcResult.value.amountOut
			nextCachedRepPrices.repUsdcSource = repUsdcResult.value.source.protocol === 'mock' ? 'mock' : 'v4'
			nextCachedRepPrices.repUsdcSourceUrl = repUsdcResult.value.source.poolUrl
			hasNextCachedRepPrices = true
		} else if (!isRepPricingEnabled()) {
			nextCachedRepPrices.repUsdcPrice = undefined
			nextCachedRepPrices.repUsdcSource = undefined
			nextCachedRepPrices.repUsdcSourceUrl = undefined
			hasNextCachedRepPrices = true
		}

		const failures = {
			repPerEthFailure: repPerEthResult.status === 'rejected' ? classifyRepPriceFailure(repPerEthResult.reason) : undefined,
			repUsdcFailure: repUsdcResult.status === 'rejected' ? classifyRepPriceFailure(repUsdcResult.reason) : undefined,
		}
		if (!hasNextCachedRepPrices) return { prices: getCachedRepPrices(backend), ...failures }
		if (repPriceRefreshGenerationByBackend.get(backend) !== refreshGeneration) {
			return {
				prices: getCachedRepPrices(backend),
				repPerEthFailure: undefined,
				repUsdcFailure: undefined,
			}
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
	const cachedRepPrices = getCachedRepPrices(backend)
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
	const applyRepPriceLoadResult = (result: RepPriceLoadResult) => {
		repPerEthFailure.value = result.prices?.repPerEthPrice === undefined ? result.repPerEthFailure : undefined
		repUsdcFailure.value = result.prices?.repUsdcPrice === undefined ? result.repUsdcFailure : undefined
		if (result.prices === undefined) return
		repPerEthPrice.value = result.prices.repPerEthPrice
		repPerEthSource.value = result.prices.repPerEthSource
		repPerEthSourceUrl.value = result.prices.repPerEthSourceUrl
		repUsdcPrice.value = result.prices.repUsdcPrice
		repUsdcSource.value = result.prices.repUsdcSource
		repUsdcSourceUrl.value = result.prices.repUsdcSourceUrl
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
				// prices unavailable — leave the last successful values in place
			})
	}

	const refreshRepPrices = () => {
		refreshRepPricesInternal(true)
	}

	useEffect(() => {
		if (!enabled) return
		refreshRepPricesInternal(false)
	}, [backend, enabled])

	const hasLoadedRepPrices = repPerEthPrice.value !== undefined || repUsdcPrice.value !== undefined

	return {
		isLoadingRepPrices: repPricesLoad.isLoading.value && !hasLoadedRepPrices,
		isRefreshingRepPrices: repPricesLoad.isLoading.value,
		repPerEthFailure: repPerEthFailure.value,
		repPerEthPrice: repPerEthPrice.value,
		repPerEthSource: repPerEthSource.value,
		repPerEthSourceUrl: repPerEthSourceUrl.value,
		repUsdcFailure: repUsdcFailure.value,
		repUsdcPrice: repUsdcPrice.value,
		repUsdcSource: repUsdcSource.value,
		repUsdcSourceUrl: repUsdcSourceUrl.value,
		refreshRepPrices,
	}
}
