import type { ArbitrageDirection } from '#core/strategy'

export function hedgedProfitBeforeGasWeth(direction: ArbitrageDirection, actualHedgeAttoWeth: bigint, currentAmount1: bigint, feeAttoWeth: bigint, protocolFeeAttoWeth: bigint) {
	const openOracleWeth = currentAmount1 + feeAttoWeth + protocolFeeAttoWeth
	return direction === 'sell-rep' ? actualHedgeAttoWeth - openOracleWeth : currentAmount1 - actualHedgeAttoWeth
}

export function realizedNetProfitWeth(hedgedProfitBeforeGas: bigint, settlerRewardAttoEth: bigint, entryGasCost: bigint, lifecycleGasCost: bigint) {
	return hedgedProfitBeforeGas + settlerRewardAttoEth - entryGasCost - lifecycleGasCost
}

export function recoveredHedgedProfitBeforeGasWeth(direction: ArbitrageDirection, quotedProfitBeforeGas: bigint, quotedHedgeAttoWeth: bigint, actualHedgeAttoWeth: bigint) {
	return direction === 'sell-rep' ? quotedProfitBeforeGas + actualHedgeAttoWeth - quotedHedgeAttoWeth : quotedProfitBeforeGas + quotedHedgeAttoWeth - actualHedgeAttoWeth
}

export function expectedWithdrawalToken2(direction: ArbitrageDirection, currentAmount2: bigint, newAmount2: bigint) {
	return direction === 'sell-rep' && currentAmount2 > newAmount2 ? currentAmount2 : newAmount2
}

const OPEN_ORACLE_PERCENTAGE_PRECISION = 10_000_000n

export function replacementCredit(parameters: { feePercentage: bigint; newAmount1: bigint; newAmount2: bigint; oldAmount1: bigint; oldAmount2: bigint }) {
	const swapsToken2 = parameters.newAmount2 * parameters.oldAmount1 > parameters.oldAmount2 * parameters.newAmount1
	if (swapsToken2) {
		return {
			amount: 2n * parameters.oldAmount2 + (parameters.oldAmount2 * parameters.feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION,
			token: 'token2' as const,
		}
	}
	return {
		amount: 2n * parameters.oldAmount1 + (parameters.oldAmount1 * parameters.feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION,
		token: 'token1' as const,
	}
}
