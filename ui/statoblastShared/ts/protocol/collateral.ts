import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
export type CollateralSymbol = 'WETH' | 'USDC'
export function securityPoolCollateral(profile: NetworkProfile, symbol: CollateralSymbol) {
	const address = { WETH: profile.wethAddress, USDC: profile.usdcAddress }[symbol]
	return { symbol, address, decimals: symbol === 'WETH' ? 18 : 6 }
}

export function collateralPresentation(address: Address | undefined) {
	if (address === undefined) return { address, symbol: 'Collateral', decimals: 0 }
	const profile = getActiveNetworkProfile()
	return (['WETH', 'USDC'] as const).map(symbol => securityPoolCollateral(profile, symbol)).find(token => token.address.toLowerCase() === address.toLowerCase()) ?? { address, symbol: 'Collateral units', decimals: 0 }
}
