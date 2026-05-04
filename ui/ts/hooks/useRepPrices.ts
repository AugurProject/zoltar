import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource, ETH_ADDRESS, REP_ADDRESS } from '../lib/uniswapQuoter.js'

const ONE_ETH = 10n ** 18n
const ONE_REP = 10n ** 18n

type PriceSource = 'v4' | 'v3'

type RepPrices = {
	repPerEthPrice: bigint | undefined // REP in wei-style token units received for 1 ETH
	repPerEthSource: PriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
	repUsdcSource: PriceSource | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
}

async function fetchRepPerEthPrice(client: ReturnType<typeof createConnectedReadClient>): Promise<{ price: bigint; source: PriceSource; sourceUrl: string | undefined }> {
	try {
		const { amountOut, source } = await quoteBestExactInputWithSource(client, ETH_ADDRESS, REP_ADDRESS, ONE_ETH)
		return { price: amountOut, source: 'v4', sourceUrl: source.poolUrl }
	} catch {
		// V4 REP/ETH pool doesn't exist yet — fall back to V3 WETH/REP (1% pool)
		const { amountOut, source } = await quoteBestV3ExactInputWithSource(client, ETH_ADDRESS, REP_ADDRESS, ONE_ETH)
		return { price: amountOut, source: 'v3', sourceUrl: source.poolUrl }
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

	useEffect(() => {
		let cancelled = false
		const client = createConnectedReadClient()

		void repPricesLoad
			.track(async () => {
				const [{ price: repPerEthDisplayPrice, source: repPerEthDisplaySource, sourceUrl: repPerEthDisplaySourceUrl }, usdcQuote] = await Promise.all([fetchRepPerEthPrice(client), quoteRepForUsdcV4WithSource(client, ONE_REP)])
				if (cancelled) return
				repPerEthPrice.value = repPerEthDisplayPrice
				repPerEthSource.value = repPerEthDisplaySource
				repPerEthSourceUrl.value = repPerEthDisplaySourceUrl
				repUsdcPrice.value = usdcQuote.amountOut
				repUsdcSource.value = 'v4'
				repUsdcSourceUrl.value = usdcQuote.source.poolUrl
			})
			.catch(() => {
				// prices unavailable — leave as undefined
			})

		return () => {
			cancelled = true
		}
	}, [])

	return {
		repPerEthPrice: repPerEthPrice.value,
		repPerEthSource: repPerEthSource.value,
		repPerEthSourceUrl: repPerEthSourceUrl.value,
		repUsdcPrice: repUsdcPrice.value,
		repUsdcSource: repUsdcSource.value,
		repUsdcSourceUrl: repUsdcSourceUrl.value,
		isLoadingRepPrices: repPricesLoad.isLoading.value,
	}
}
