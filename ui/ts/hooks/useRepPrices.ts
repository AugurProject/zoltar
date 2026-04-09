import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
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
	const isLoadingRepPrices = useSignal(false)

	useEffect(() => {
		let cancelled = false
		const client = createConnectedReadClient()
		isLoadingRepPrices.value = true

		void Promise.all([fetchRepEthPrice(client), quoteRepForUsdcV4(client, ONE_REP)])
			.then(([{ price: ethPrice, source: ethSource }, usdcPrice]) => {
				if (cancelled) return
				repEthPrice.value = ethPrice
				repEthSource.value = ethSource
				repUsdcPrice.value = usdcPrice
				repUsdcSource.value = 'v4'
			})
			.catch(() => {
				// prices unavailable — leave as undefined
			})
			.finally(() => {
				if (!cancelled) isLoadingRepPrices.value = false
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
		isLoadingRepPrices: isLoadingRepPrices.value,
	}
}
