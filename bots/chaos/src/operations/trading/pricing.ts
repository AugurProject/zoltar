import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { BPS_DENOMINATOR } from '../oracle-request-funding.ts'
import { amount } from '../planning.ts'
import type { PairSnapshot, PoolSnapshot } from '../types.ts'

const TRADING_SLIPPAGE_BPS = 100n
export const MAXIMUM_TRADING_SPEND = 10n ** 15n

export function minimumAfterSlippage(value: bigint) {
	if (value <= 0n) return 0n
	const bounded = (value * (BPS_DENOMINATOR - TRADING_SLIPPAGE_BPS)) / BPS_DENOMINATOR
	return bounded > 0n ? bounded : 1n
}

export function maximumAfterSlippage(value: bigint) {
	if (value <= 0n) return 0n
	return (value * (BPS_DENOMINATOR + TRADING_SLIPPAGE_BPS) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

const feeIsValid = (pair: PairSnapshot) => pair.feeBps >= 0 && pair.feeBps < 10_000

function directionalReserves(pair: PairSnapshot, yesForNo: boolean) {
	return {
		reserveIn: amount(yesForNo ? pair.effectiveYesReserve : pair.effectiveNoReserve),
		reserveOut: amount(yesForNo ? pair.effectiveNoReserve : pair.effectiveYesReserve),
	}
}

export function quoteExactInput(pair: PairSnapshot, yesForNo: boolean, input: bigint) {
	const { reserveIn, reserveOut } = directionalReserves(pair, yesForNo)
	if (input <= 0n || reserveIn <= 0n || reserveOut <= 0n || !feeIsValid(pair)) return 0n
	const netInput = (input * (BPS_DENOMINATOR - BigInt(pair.feeBps))) / BPS_DENOMINATOR
	if (netInput === 0n) return 0n
	return (reserveOut * netInput) / (reserveIn + netInput)
}

export function quoteExactOutput(pair: PairSnapshot, yesForNo: boolean, output: bigint) {
	const { reserveIn, reserveOut } = directionalReserves(pair, yesForNo)
	// An unquotable pair returns undefined; the guards keep both ceilDiv denominators positive.
	if (output <= 0n || output >= reserveOut || reserveIn <= 0n || !feeIsValid(pair)) return undefined
	const netInput = ceilDiv(reserveIn * output, reserveOut - output)
	return ceilDiv(netInput * BPS_DENOMINATOR, BPS_DENOMINATOR - BigInt(pair.feeBps))
}

export function removableLiquidity(pair: PairSnapshot) {
	const totalSupply = amount(pair.totalSupply)
	const liquidity = amount(pair.walletLiquidity) > MAXIMUM_TRADING_SPEND ? MAXIMUM_TRADING_SPEND : amount(pair.walletLiquidity)
	if (liquidity === 0n || totalSupply === 0n) return 0n
	if ((amount(pair.effectiveYesReserve) * liquidity) / totalSupply === 0n || (amount(pair.effectiveNoReserve) * liquidity) / totalSupply === 0n) return 0n
	return liquidity
}

export function removableLiquidityQuote(pair: PairSnapshot, liquidity: bigint) {
	const totalSupply = amount(pair.totalSupply)
	if (liquidity <= 0n || totalSupply <= 0n) return undefined
	const yesOut = (amount(pair.effectiveYesReserve) * liquidity) / totalSupply
	const noOut = (amount(pair.effectiveNoReserve) * liquidity) / totalSupply
	return yesOut > 0n && noOut > 0n ? { noOut, yesOut } : undefined
}

export function proportionalLiquidity(pair: PairSnapshot, maxYes: bigint, maxNo: bigint) {
	const yesReserve = amount(pair.effectiveYesReserve)
	const noReserve = amount(pair.effectiveNoReserve)
	const totalSupply = amount(pair.totalSupply)
	if (yesReserve === 0n || noReserve === 0n || totalSupply === 0n || maxYes === 0n || maxNo === 0n) return undefined
	const [yesUsed, noUsed] = maxYes * noReserve <= maxNo * yesReserve ? [maxYes, (maxYes * noReserve) / yesReserve] : [(maxNo * yesReserve) / noReserve, maxNo]
	if (yesUsed === 0n || noUsed === 0n) return undefined
	const yesLiquidity = (yesUsed * totalSupply) / yesReserve
	const noLiquidity = (noUsed * totalSupply) / noReserve
	const liquidity = yesLiquidity < noLiquidity ? yesLiquidity : noLiquidity
	return liquidity === 0n ? undefined : { liquidity, noUsed, yesUsed }
}

export function minimumPositivePayoutShares(pool: PoolSnapshot) {
	const supply = amount(pool.shareTokenSupplyAttoShares)
	const collateral = amount(pool.projectedSettlementCollateralAttoEth)
	return supply <= 0n || collateral <= 0n ? undefined : ceilDiv(supply, collateral)
}

export const minimumOf = (values: readonly bigint[]) => values.reduce((minimum, value) => (value < minimum ? value : minimum))

export const cappedTradingSpend = (balance: bigint) => (balance > MAXIMUM_TRADING_SPEND ? MAXIMUM_TRADING_SPEND : balance)
