import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useLoadController } from './useLoadController.js'
import { createReadClientForNetwork } from '../lib/clients.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteRepForUsdcV4WithSource, ETH_ADDRESS } from '../lib/uniswapQuoter.js'
import { getNetworkConfig, type SupportedNetworkKey } from '../shared/networkConfig.js'

const ONE_REP = 10n ** 18n

type PriceSource = 'v4' | 'v3'

type RepPrices = {
	repEthPrice: bigint | undefined // ETH in wei received for 1 REP
	repEthSource: PriceSource | undefined
	repEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined // USDC in 1e6 units received for 1 REP
	repUsdcSource: PriceSource | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
}

async function fetchRepEthPrice(networkKey: SupportedNetworkKey, client: ReturnType<typeof createReadClientForNetwork>): Promise<{ price: bigint; source: PriceSource; sourceUrl: string | undefined }> {
	const networkConfig = getNetworkConfig(networkKey)
	try {
		const { amountOut, source } = await quoteBestExactInputWithSource(client, networkConfig.genesisRepTokenAddress, ETH_ADDRESS, ONE_REP, networkConfig.repEthV4PoolConfigs)
		return { price: amountOut, source: 'v4', sourceUrl: source.poolUrl }
	} catch {
		const { amountOut, source } = await quoteBestV3ExactInputWithSource(client, networkConfig.genesisRepTokenAddress, ETH_ADDRESS, ONE_REP, networkConfig.repV3FallbackFees)
		return { price: amountOut, source: 'v3', sourceUrl: source.poolUrl }
	}
}

export function useRepPrices(activeNetworkKey: SupportedNetworkKey): RepPrices {
	const repEthPrice = useSignal<bigint | undefined>(undefined)
	const repEthSource = useSignal<PriceSource | undefined>(undefined)
	const repEthSourceUrl = useSignal<string | undefined>(undefined)
	const repUsdcPrice = useSignal<bigint | undefined>(undefined)
	const repUsdcSource = useSignal<PriceSource | undefined>(undefined)
	const repUsdcSourceUrl = useSignal<string | undefined>(undefined)
	const repPricesLoad = useLoadController()

	useEffect(() => {
		let cancelled = false
		const client = createReadClientForNetwork(activeNetworkKey)

		void repPricesLoad
			.track(async () => {
				const [{ price: ethPrice, source: ethSource, sourceUrl: ethSourceUrl }, usdcQuote] = await Promise.all([fetchRepEthPrice(activeNetworkKey, client), quoteRepForUsdcV4WithSource(client, ONE_REP)])
				if (cancelled) return
				repEthPrice.value = ethPrice
				repEthSource.value = ethSource
				repEthSourceUrl.value = ethSourceUrl
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
	}, [activeNetworkKey])

	return {
		repEthPrice: repEthPrice.value,
		repEthSource: repEthSource.value,
		repEthSourceUrl: repEthSourceUrl.value,
		repUsdcPrice: repUsdcPrice.value,
		repUsdcSource: repUsdcSource.value,
		repUsdcSourceUrl: repUsdcSourceUrl.value,
		isLoadingRepPrices: repPricesLoad.isLoading.value,
	}
}
