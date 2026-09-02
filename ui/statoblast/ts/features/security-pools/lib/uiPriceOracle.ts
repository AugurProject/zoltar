import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-zoltar/protocol/oracleTiming.js'
import type { UiPriceOracle } from '@zoltar/ui-core-shared/app/components/AppSettingsMenu.js'

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
	if (priceOracle === 'open-oracle') return openOraclePrice
	return isUiOpenOraclePriceUsed({ currentTimestamp, openOraclePrice, openOracleSettlementTimestamp, openOracleValid, priceOracle }) ? openOraclePrice : uniswapPrice
}

export function isUiOpenOraclePriceUsed({ currentTimestamp, openOraclePrice, openOracleSettlementTimestamp, openOracleValid, priceOracle }: Omit<Parameters<typeof resolveUiRepPerEthPrice>[0], 'uniswapPrice'>) {
	if (priceOracle === 'uniswap' || openOraclePrice === undefined) return false
	if (priceOracle === 'open-oracle') return true
	if (openOracleValid === false || openOracleSettlementTimestamp === undefined || currentTimestamp === undefined) return false
	const validUntil = getOracleManagerPriceValidUntilTimestamp(openOracleSettlementTimestamp)
	return validUntil !== undefined && currentTimestamp < validUntil
}
