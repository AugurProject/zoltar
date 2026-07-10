import { getLiquidationRepToMove } from '@zoltar/shared/liquidation'

export function getExpectedLiquidationRepMove(debtToMove: bigint, repEthPrice: bigint) {
	return getLiquidationRepToMove(debtToMove, repEthPrice)
}
