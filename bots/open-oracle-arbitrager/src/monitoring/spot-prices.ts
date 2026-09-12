import { type Address, formatUnits } from '@zoltar/bot-shared/ethereum'

export function poolSpotPriceWeth(sqrtPriceX96: bigint, token: Address, weth: Address, decimals: number) {
	if (sqrtPriceX96 === 0n) return undefined
	const squared = sqrtPriceX96 * sqrtPriceX96
	const q192 = 2n ** 192n
	const oneToken = 10n ** BigInt(decimals)
	const attoWeth = BigInt(token.toLowerCase()) < BigInt(weth.toLowerCase()) ? (oneToken * squared) / q192 : (oneToken * q192) / squared
	return formatUnits(attoWeth, 18)
}

export function constantProductSpotPriceWeth(reserveToken: bigint, reserveAttoWeth: bigint, tokenDecimals: number) {
	if (reserveToken === 0n || reserveAttoWeth === 0n) return undefined
	return formatUnits((reserveAttoWeth * 10n ** BigInt(tokenDecimals)) / reserveToken, 18)
}
