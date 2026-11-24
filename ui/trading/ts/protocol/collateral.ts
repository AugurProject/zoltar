import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { bigintToSafeNumber, type Address, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatRoundedUnits } from '../lib/format.js'
import { collateralPresentation } from '@zoltar/ui-statoblast-shared/protocol/collateral.js'
import { tokenDisplayLabel } from '@zoltar/ui-core-shared/lib/tokenLabel.js'

export type TradingCollateral = Readonly<{ token: Address; symbol: string; decimals: number; native: boolean }>
export type CollateralMarket = Readonly<{ collateral?: TradingCollateral | undefined }>

export function collateralAsset(market: CollateralMarket) {
	return market.collateral ?? { token: getActiveNetworkProfile().wethAddress, symbol: 'ETH', decimals: 18, native: true }
}

export function tokenFunded(market: CollateralMarket) {
	return !collateralAsset(market).native
}

export function formatCollateralAmount(value: bigint, market: CollateralMarket, digits = 2, rounding: 'nearest' | 'down' = 'nearest') {
	const asset = collateralAsset(market)
	const amount = rounding === 'down' ? formatTrimmedUnits(value, asset.decimals, digits) : formatRoundedUnits(value, asset.decimals, digits)
	return `${amount} ${asset.symbol}`
}

export async function loadTradingCollateralAsset(client: Pick<PublicClient, 'readContract'>, token: Address, blockNumber?: bigint): Promise<TradingCollateral> {
	const known = collateralPresentation(token)
	if (token.toLowerCase() === getActiveNetworkProfile().wethAddress.toLowerCase()) return { token, symbol: 'ETH', decimals: 18, native: true }
	if (known.symbol === 'USDC') return { token, symbol: known.symbol, decimals: known.decimals, native: false }
	const [symbolResult, decimalsResult] = await Promise.allSettled([client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'symbol', blockNumber }), client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'decimals', blockNumber })])
	const rawDecimals = decimalsResult.status === 'fulfilled' ? decimalsResult.value : undefined
	if (rawDecimals === undefined || rawDecimals < 0n || rawDecimals > 255n) return { token, symbol: 'Collateral base units', decimals: 0, native: false }
	// Only the profile's WETH and USDC are identified by address; any other token's self-reported symbol carries its address (#1462).
	const symbol = tokenDisplayLabel({ address: token, symbol: symbolResult.status === 'fulfilled' ? symbolResult.value : undefined, verified: false })
	return { token, symbol, decimals: bigintToSafeNumber(rawDecimals, 'Collateral decimals'), native: false }
}
