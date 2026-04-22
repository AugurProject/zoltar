import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useLoadController } from './useLoadController.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { quoteRepForEth, quoteRepForEthV3, quoteRepForUsdcV4 } from '../lib/uniswapQuoter.js'

const ONE_REP = 10n ** 18n

type PriceSource = 'v4' | 'v3'

type RepPrices = {
	repEthPrice: bigint | undefined // ETH in wei received for 1 REP
	repEthSource: PriceSource | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
	repUsdcSource: PriceSource | undefined
	isLoadingRepPrices: boolean
}

async function fetchRepEthPrice(client: ReturnType<typeof createConnectedReadClient>): Promise<{ price: bigint; source: PriceSource }> {
	try {
		const price = await quoteRepForEth(client, ONE_REP)
		return { price, source: 'v4' }
	} catch {
		// V4 REP/ETH pool doesn't exist yet — fall back to V3 REP/WETH (1% pool)
		const price = await quoteRepForEthV3(client, ONE_REP)
		return { price, source: 'v3' }
	}
}

export function useRepPrices(): RepPrices {
	const repEthPrice = useSignal<bigint | undefined>(undefined)
	const repEthSource = useSignal<PriceSource | undefined>(undefined)
	const repUsdcPrice = useSignal<bigint | undefined>(undefined)
	const repUsdcSource = useSignal<PriceSource | undefined>(undefined)
	const repPricesLoad = useLoadController()

	useEffect(() => {
		let cancelled = false
		const client = createConnectedReadClient()

		void repPricesLoad
			.track(async () => {
				const [{ price: ethPrice, source: ethSource }, usdcPrice] = await Promise.all([fetchRepEthPrice(client), quoteRepForUsdcV4(client, ONE_REP)])
				if (cancelled) return
				repEthPrice.value = ethPrice
				repEthSource.value = ethSource
				repUsdcPrice.value = usdcPrice
				repUsdcSource.value = 'v4'
			})
			.catch(() => {
				// prices unavailable — leave as undefined
			})

		return () => {
			cancelled = true
		}
	}, [])

	return {
		repEthPrice: repEthPrice.value,
		repEthSource: repEthSource.value,
		repUsdcPrice: repUsdcPrice.value,
		repUsdcSource: repUsdcSource.value,
		isLoadingRepPrices: repPricesLoad.isLoading.value,
	}
}
