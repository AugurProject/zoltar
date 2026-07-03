import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useLoadController } from './useLoadController.js'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import type { ChainBackend } from '../lib/chainBackend.js'
import { isRecoverableQuoteError } from '../lib/errors.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource, ETH_ADDRESS, getRepAddress, isRepPricingEnabled } from '../lib/uniswapQuoter.js'

const ONE_ETH = 10n ** 18n
const ONE_REP = 10n ** 18n
const REP_PRICE_CACHE_TTL_MILLISECONDS = 30_000

type PriceSource = 'v4' | 'v3' | 'mock'

type RepPrices = {
	repPerEthPrice: bigint | undefined // REP in wei-style token units received for 1 ETH
	repPerEthSource: PriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
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

type UseRepPricesOptions = {
	enabled?: boolean
}

const repPriceCacheByBackend = new Map<ChainBackend, CachedRepPrices>()
const repPriceRefreshByBackend = new Map<ChainBackend, Promise<CachedRepPrices | undefined>>()

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

async function loadRepPrices(backend: ChainBackend, forceRefresh: boolean) {
	const cachedRepPrices = forceRefresh ? undefined : getFreshCachedRepPrices(backend)
	if (cachedRepPrices !== undefined) return cachedRepPrices

	const pendingRefresh = repPriceRefreshByBackend.get(backend)
	if (pendingRefresh !== undefined) return await pendingRefresh

	const refreshPromise = (async () => {
		const client = backend.createReadClient()
		const [repPerEthResult, repUsdcResult] = await Promise.allSettled([fetchRepPerEthPrice(client), quoteRepForUsdcV4WithSource(client, ONE_REP)])
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

		if (!hasNextCachedRepPrices) return getCachedRepPrices(backend)
		repPriceCacheByBackend.set(backend, nextCachedRepPrices)
		return nextCachedRepPrices
	})()

	repPriceRefreshByBackend.set(backend, refreshPromise)

	try {
		return await refreshPromise
	} finally {
		repPriceRefreshByBackend.delete(backend)
	}
}

export function useRepPrices({ enabled = true }: UseRepPricesOptions = {}): RepPrices {
	const backend = getActiveBackend()
	const cachedRepPrices = getCachedRepPrices(backend)
	const repPerEthPrice = useSignal<bigint | undefined>(cachedRepPrices?.repPerEthPrice)
	const repPerEthSource = useSignal<PriceSource | undefined>(cachedRepPrices?.repPerEthSource)
	const repPerEthSourceUrl = useSignal<string | undefined>(cachedRepPrices?.repPerEthSourceUrl)
	const repUsdcPrice = useSignal<bigint | undefined>(cachedRepPrices?.repUsdcPrice)
	const repUsdcSource = useSignal<PriceSource | undefined>(cachedRepPrices?.repUsdcSource)
	const repUsdcSourceUrl = useSignal<string | undefined>(cachedRepPrices?.repUsdcSourceUrl)
	const repPricesLoad = useLoadController()
	const applyCachedRepPrices = (nextCachedRepPrices: CachedRepPrices) => {
		repPerEthPrice.value = nextCachedRepPrices.repPerEthPrice
		repPerEthSource.value = nextCachedRepPrices.repPerEthSource
		repPerEthSourceUrl.value = nextCachedRepPrices.repPerEthSourceUrl
		repUsdcPrice.value = nextCachedRepPrices.repUsdcPrice
		repUsdcSource.value = nextCachedRepPrices.repUsdcSource
		repUsdcSourceUrl.value = nextCachedRepPrices.repUsdcSourceUrl
	}

	const refreshRepPricesInternal = (forceRefresh: boolean) => {
		const nextFreshCachedRepPrices = forceRefresh ? undefined : getFreshCachedRepPrices(backend)
		if (nextFreshCachedRepPrices !== undefined) {
			applyCachedRepPrices(nextFreshCachedRepPrices)
			return
		}

		void repPricesLoad
			.track(async () => {
				const nextCachedRepPrices = await loadRepPrices(backend, forceRefresh)
				if (nextCachedRepPrices === undefined) return
				applyCachedRepPrices(nextCachedRepPrices)
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
		repPerEthPrice: repPerEthPrice.value,
		repPerEthSource: repPerEthSource.value,
		repPerEthSourceUrl: repPerEthSourceUrl.value,
		repUsdcPrice: repUsdcPrice.value,
		repUsdcSource: repUsdcSource.value,
		repUsdcSourceUrl: repUsdcSourceUrl.value,
		refreshRepPrices,
	}
}
