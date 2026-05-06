import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource, ETH_ADDRESS, REP_ADDRESS, isRepPricingEnabled } from '../lib/uniswapQuoter.js'

const ONE_ETH = 10n ** 18n
const ONE_REP = 10n ** 18n

type PriceSource = 'v4' | 'v3' | 'mock'

type RepPrices = {
	repPerEthPrice: bigint | undefined // REP in wei-style token units received for 1 ETH
	repPerEthSource: PriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
	repUsdcSource: PriceSource | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
	refreshRepPrices: () => void
}

async function fetchRepPerEthPrice(client: ReturnType<typeof createConnectedReadClient>): Promise<{ price: bigint; source: PriceSource; sourceUrl: string | undefined }> {
	try {
		const { amountOut, source } = await quoteBestExactInputWithSource(client, ETH_ADDRESS, REP_ADDRESS, ONE_ETH)
		return { price: amountOut, source: source.protocol === 'mock' ? 'mock' : 'v4', sourceUrl: source.poolUrl }
	} catch {
		// V4 REP/ETH pool doesn't exist yet — fall back to V3 WETH/REP (1% pool)
		const { amountOut, source } = await quoteBestV3ExactInputWithSource(client, ETH_ADDRESS, REP_ADDRESS, ONE_ETH)
		return { price: amountOut, source: source.protocol === 'mock' ? 'mock' : 'v3', sourceUrl: source.poolUrl }
	}
}

export function useRepPrices(): RepPrices {
	const repPerEthPrice = useSignal<bigint | undefined>(undefined)
	const repPerEthSource = useSignal<PriceSource | undefined>(undefined)
	const repPerEthSourceUrl = useSignal<string | undefined>(undefined)
	const repUsdcPrice = useSignal<bigint | undefined>(undefined)
	const repUsdcSource = useSignal<PriceSource | undefined>(undefined)
	const repUsdcSourceUrl = useSignal<string | undefined>(undefined)
	const repPricesLoad = useLoadController()

	const refreshRepPrices = () => {
		const client = createConnectedReadClient()

		void repPricesLoad
			.track(async () => {
				const [repPerEthResult, repUsdcResult] = await Promise.allSettled([fetchRepPerEthPrice(client), quoteRepForUsdcV4WithSource(client, ONE_REP)])

				if (repPerEthResult.status === 'fulfilled') {
					repPerEthPrice.value = repPerEthResult.value.price
					repPerEthSource.value = repPerEthResult.value.source
					repPerEthSourceUrl.value = repPerEthResult.value.sourceUrl
				}

				if (repUsdcResult.status === 'fulfilled') {
					repUsdcPrice.value = repUsdcResult.value.amountOut
					repUsdcSource.value = 'v4'
					repUsdcSourceUrl.value = repUsdcResult.value.source.poolUrl
				} else if (!isRepPricingEnabled()) {
					repUsdcPrice.value = undefined
					repUsdcSource.value = undefined
					repUsdcSourceUrl.value = undefined
				}
			})
			.catch(() => {
				// prices unavailable — leave the last successful values in place
			})
	}

	useEffect(() => {
		refreshRepPrices()
	}, [])

	return {
		isLoadingRepPrices: repPricesLoad.isLoading.value,
		repPerEthPrice: repPerEthPrice.value,
		repPerEthSource: repPerEthSource.value,
		repPerEthSourceUrl: repPerEthSourceUrl.value,
		repUsdcPrice: repUsdcPrice.value,
		repUsdcSource: repUsdcSource.value,
		repUsdcSourceUrl: repUsdcSourceUrl.value,
		refreshRepPrices,
	}
}
