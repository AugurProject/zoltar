import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-zoltar/protocol/oracleTiming.js'

export type UiPriceOracle = 'uniswap' | 'open-oracle' | 'open-oracle-fallback'

export function resolveUiRepPerEthPrice({
	currentTimestamp,
	openOraclePrice,
	openOracleSettlementTimestamp,
	openOracleValid,
	priceOracle,
	uniswapPrice,
}: {
	currentTimestamp: bigint | undefined
	openOraclePrice: bigint | undefined
	openOracleSettlementTimestamp: bigint | undefined
	openOracleValid?: boolean | undefined
	priceOracle: UiPriceOracle
	uniswapPrice: bigint | undefined
}) {
	if (priceOracle === 'uniswap') return uniswapPrice
	if (priceOracle === 'open-oracle') return hasOpenOracleSettlement(openOraclePrice, openOracleSettlementTimestamp) ? openOraclePrice : undefined
	return isUiOpenOraclePriceUsed({ currentTimestamp, openOraclePrice, openOracleSettlementTimestamp, openOracleValid, priceOracle }) ? openOraclePrice : uniswapPrice
}

function hasOpenOracleSettlement(openOraclePrice: bigint | undefined, openOracleSettlementTimestamp: bigint | undefined) {
	return openOraclePrice !== undefined && openOracleSettlementTimestamp !== undefined && openOracleSettlementTimestamp > 0n
}

export function isUiOpenOraclePriceUsed({ currentTimestamp, openOraclePrice, openOracleSettlementTimestamp, openOracleValid, priceOracle }: Omit<Parameters<typeof resolveUiRepPerEthPrice>[0], 'uniswapPrice'>) {
	if (priceOracle === 'uniswap' || !hasOpenOracleSettlement(openOraclePrice, openOracleSettlementTimestamp)) return false
	if (priceOracle === 'open-oracle') return true
	if (openOracleValid === false || openOracleSettlementTimestamp === undefined || currentTimestamp === undefined) return false
	const validUntil = getOracleManagerPriceValidUntilTimestamp(openOracleSettlementTimestamp)
	return validUntil !== undefined && currentTimestamp < validUntil
}
