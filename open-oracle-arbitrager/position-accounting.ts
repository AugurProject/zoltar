import type { ArbitrageDirection } from './strategy.js'

export function hedgedProfitBeforeGasWeth(direction: ArbitrageDirection, actualHedgeWeth: bigint, currentAmount1: bigint, feeWeth: bigint, protocolFeeWeth: bigint) {
	const openOracleWeth = currentAmount1 + feeWeth + protocolFeeWeth
	return direction === 'sell-rep' ? actualHedgeWeth - openOracleWeth : currentAmount1 - actualHedgeWeth
}

export function realizedNetProfitWeth(hedgedProfitBeforeGas: bigint, settlerReward: bigint, entryGasCost: bigint, lifecycleGasCost: bigint) {
	return hedgedProfitBeforeGas + settlerReward - entryGasCost - lifecycleGasCost
}

export function recoveredHedgedProfitBeforeGasWeth(direction: ArbitrageDirection, quotedProfitBeforeGas: bigint, quotedHedgeWeth: bigint, actualHedgeWeth: bigint) {
	return direction === 'sell-rep' ? quotedProfitBeforeGas + actualHedgeWeth - quotedHedgeWeth : quotedProfitBeforeGas + quotedHedgeWeth - actualHedgeWeth
}

export function expectedWithdrawalToken2(direction: ArbitrageDirection, currentAmount2: bigint, newAmount2: bigint) {
	return direction === 'sell-rep' && currentAmount2 > newAmount2 ? currentAmount2 : newAmount2
}
