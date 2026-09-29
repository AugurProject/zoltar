import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import type { LiveMarket } from '../../protocol/live.js'

/** Production controller services with the RPC client and deployment check stubbed out; tests spread it and override the discovery and wallet reads they drive. */
export const offlineControllerServices = {
	...liveTradingControllerServices,
	createTradingPublicClient: () => ({}),
	validateLiveDeployment: async () => undefined,
}

/** One unpaged discovery result holding every given market. */
export function discoveryPage(markets: LiveMarket[], universeIds: bigint[] = [1n], selectedUniverseId = 1n) {
	return { start: 0n, count: BigInt(markets.length), total: BigInt(markets.length), previousStart: undefined, nextStart: undefined, markets, universeIds, selectedUniverseId }
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
