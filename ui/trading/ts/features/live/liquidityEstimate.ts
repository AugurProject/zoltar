import { conditionalYesBps } from '@zoltar/trading-shared/trading/math'
import { attoSharesToCollateralAttoEth, collateralAttoEthToAttoShares } from '../../lib/shareValue.js'
import type { LiquidityOperation, LiveMarket } from '../../protocol/live.js'

const BPS = 10_000n
/** Mirrors TwoWayConstantProductPair.MINIMUM_LIQUIDITY, the LP locked forever by the first deposit. */
export const MINIMUM_LIQUIDITY = 1_000n

type PoolState = Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'lpTotalSupply' | 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares'>

/**
 * What a liquidity operation moves, in one shape for both the wallet simulation and the public-state estimate.
 * Deposits mint complete sets from ETH and keep `invalidReturned`, `yesReturned`, and `noReturned` in the wallet;
 * a removal burns LP for `yesOut` and `noOut`.
 */
export type LiquidityPreview = Readonly<{ operation: 'initialize' | 'add'; amount: bigint; liquidity: bigint; completeSets: bigint; yesUsed: bigint; noUsed: bigint; invalidReturned: bigint; yesReturned: bigint; noReturned: bigint }> | Readonly<{ operation: 'remove'; amount: bigint; yesOut: bigint; noOut: bigint }>

function minimum(left: bigint, right: bigint) {
	return left < right ? left : right
}

/** Mirrors TwoWayConstantProductMath.initialLiquidityAmounts. */
function initialDeposit(completeSets: bigint, yesBps: bigint) {
	if (yesBps >= 5_000n) return { yesUsed: (completeSets * (BPS - yesBps)) / yesBps, noUsed: completeSets }
	return { yesUsed: completeSets, noUsed: (completeSets * yesBps) / (BPS - yesBps) }
}

/** Mirrors TwoWayConstantProductMath.proportionalDeposit for an equal YES and NO maximum. */
function proportionalDeposit(yesReserve: bigint, noReserve: bigint, completeSets: bigint) {
	if (noReserve <= yesReserve) return { yesUsed: completeSets, noUsed: (completeSets * noReserve) / yesReserve }
	return { yesUsed: (completeSets * yesReserve) / noReserve, noUsed: completeSets }
}

/**
 * A local liquidity preview from the last public pool state. It mirrors the router and pair arithmetic but
 * uses the loaded collateral projection and reserves. Its approved bounds are validated on chain at submission.
 * Undefined when the pool state cannot price the amount.
 */
export function estimateLiquidity(market: PoolState, operation: LiquidityOperation, amount: bigint, initialYesBps: bigint | undefined): LiquidityPreview | undefined {
	if (amount <= 0n) return undefined
	if (operation === 'remove') {
		if (market.lpTotalSupply === 0n || amount > market.lpTotalSupply) return undefined
		const yesOut = (market.yesReserve * amount) / market.lpTotalSupply
		const noOut = (market.noReserve * amount) / market.lpTotalSupply
		return yesOut === 0n || noOut === 0n ? undefined : { operation, amount, yesOut, noOut }
	}
	const completeSets = collateralAttoEthToAttoShares(amount, market)
	if (completeSets === undefined || completeSets === 0n) return undefined
	if (operation === 'initialize') {
		if (initialYesBps === undefined || initialYesBps <= 0n || initialYesBps >= BPS) return undefined
		const { yesUsed, noUsed } = initialDeposit(completeSets, initialYesBps)
		const scale = minimum(yesUsed, noUsed)
		if (yesUsed === 0n || noUsed === 0n || scale <= MINIMUM_LIQUIDITY) return undefined
		return { operation, amount, liquidity: scale - MINIMUM_LIQUIDITY, completeSets, yesUsed, noUsed, invalidReturned: completeSets, yesReturned: completeSets - yesUsed, noReturned: completeSets - noUsed }
	}
	if (market.yesReserve === 0n || market.noReserve === 0n || market.lpTotalSupply === 0n) return undefined
	const { yesUsed, noUsed } = proportionalDeposit(market.yesReserve, market.noReserve, completeSets)
	const liquidity = minimum((yesUsed * market.lpTotalSupply) / market.yesReserve, (noUsed * market.lpTotalSupply) / market.noReserve)
	if (yesUsed === 0n || noUsed === 0n || liquidity === 0n) return undefined
	return { operation, amount, liquidity, completeSets, yesUsed, noUsed, invalidReturned: completeSets, yesReturned: completeSets - yesUsed, noReturned: completeSets - noUsed }
}

/**
 * Approximate ETH value of YES and NO shares at the pool's current conditional price: each YES is worth the YES
 * price and each NO the rest, scaled by the pool's collateral per share. It assumes a valid resolution.
 */
export function outcomeSharesValueAttoEth(market: PoolState, yes: bigint, no: bigint) {
	if (market.yesReserve + market.noReserve === 0n) return undefined
	const yesBps = conditionalYesBps(market.yesReserve, market.noReserve)
	return attoSharesToCollateralAttoEth((yes * yesBps + no * (BPS - yesBps)) / BPS, market)
}
