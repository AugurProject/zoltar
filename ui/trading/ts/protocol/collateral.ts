import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { Address, PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatRoundedUnits } from '../lib/format.js'
import { collateralPresentation } from '@zoltar/ui-statoblast-shared/protocol/collateral.js'

export type TradingCollateral = Readonly<{ token: Address; symbol: string; decimals: number; native: boolean }>
export type CollateralMarket = Readonly<{ collateral?: TradingCollateral | undefined }>

export function collateralAsset(market: CollateralMarket) {
	return market.collateral ?? { token: getActiveNetworkProfile().wethAddress, symbol: 'ETH', decimals: 18, native: true }
}

export function tokenFunded(market: CollateralMarket) {
	return !collateralAsset(market).native
}

export function formatCollateralAmount(value: bigint, market: CollateralMarket, digits = 4, rounding: 'nearest' | 'down' = 'nearest') {
	const asset = collateralAsset(market)
	const amount = rounding === 'down' ? formatTrimmedUnits(value, asset.decimals, digits) : formatRoundedUnits(value, asset.decimals, digits)
	return `${amount} ${asset.symbol}`
}

export async function loadTradingCollateralAsset(client: Pick<PublicClient, 'readContract'>, token: Address, blockNumber?: bigint): Promise<TradingCollateral> {
	const known = collateralPresentation(token)
	if (token.toLowerCase() === getActiveNetworkProfile().wethAddress.toLowerCase()) return { token, symbol: 'ETH', decimals: 18, native: true }
	if (known.symbol === 'USDC' || known.symbol === 'USDT') return { token, symbol: known.symbol, decimals: known.decimals, native: false }
	const [symbolResult, decimalsResult] = await Promise.allSettled([client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'symbol', blockNumber }), client.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'decimals', blockNumber })])
	const units = decimalsResult.status === 'fulfilled' ? Number(decimalsResult.value) : undefined
	if (units === undefined || !Number.isInteger(units) || units < 0 || units > 255) return { token, symbol: 'Collateral base units', decimals: 0, native: false }
	const symbol = symbolResult.status === 'fulfilled' && symbolResult.value.trim() !== '' ? symbolResult.value : 'Collateral'
	return { token, symbol, decimals: units, native: false }
}
