import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import type { LiveMarket } from '../../protocol/live.js'
import type { MarketRegistry } from '../../features/live/useMarketRegistry.js'

/**
 * Production controller services with the RPC client and deployment check stubbed out; tests spread it and override the
 * discovery and wallet reads they drive. The market registry answers with an empty page in the requested universe.
 */
export const offlineControllerServices = {
	...liveTradingControllerServices,
	createTradingPublicClient: () => ({}),
	validateLiveDeployment: async () => undefined,
	discoverTradingMarketPage: async (_client: unknown, _configuration: unknown, requestedUniverseId: bigint | undefined) => discoveryPage([], [requestedUniverseId ?? 0n], requestedUniverseId ?? 0n),
}

/** One unpaged discovery result holding every given market. */
export function discoveryPage(markets: LiveMarket[], universeIds: bigint[] = [1n], selectedUniverseId = 1n) {
	return { start: 0n, count: BigInt(markets.length), total: BigInt(markets.length), previousStart: undefined, nextStart: undefined, markets, universeIds, selectedUniverseId }
}

/** A loaded market-registry page holding `markets`, for rendering a market list without the registry reads. */
export function readyMarketRegistry(markets: readonly LiveMarket[] = [], overrides: Partial<MarketRegistry> = {}): MarketRegistry {
	return { status: 'ready', markets, page: { start: 0n, total: BigInt(markets.length), previousStart: undefined, nextStart: undefined }, error: undefined, loadPage: () => undefined, retry: () => undefined, ...overrides }
}

/** Wallet services that connect `account` on `chainId` and report 5 ETH and 6 REP in the header. */
export function connectedWalletServices(account: Address, chainId: number) {
	return {
		walletChainId: async () => chainId,
		connectWallet: async () => account,
		loadWalletHeaderBalances: async () => ({ ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, repToken: `0x${'47'.repeat(20)}` as Address }),
	}
}

/** An injected provider that accepts listeners and answers nothing, so the live controller can subscribe to wallet events. */
export function installSilentInjectedWallet() {
	Reflect.set(window, 'ethereum', { request: async () => undefined, on: () => undefined, removeListener: () => undefined })
}
