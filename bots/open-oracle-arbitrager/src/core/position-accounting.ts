import type { OpenOracleGame } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import type { PositionRecord } from '#state/position-store'
import type { ArbitrageDirection } from '#core/strategy'
import { attoWethValue, type CollateralValuation } from '#core/collateral-valuation'

/** The hedged profit in report `token1` (collateral) base units. */
export function hedgedProfitBeforeGasToken1(direction: ArbitrageDirection, actualHedgeToken1: bigint, currentAmount1: bigint, feeToken1: bigint, protocolFeeToken1: bigint) {
	const openOracleToken1 = currentAmount1 + feeToken1 + protocolFeeToken1
	return direction === 'sell-rep' ? actualHedgeToken1 - openOracleToken1 : currentAmount1 - actualHedgeToken1
}

export function realizedNetProfitWeth(hedgedProfitBeforeGas: bigint, settlerRewardAttoEth: bigint, entryGasCost: bigint, lifecycleGasCost: bigint) {
	return hedgedProfitBeforeGas + settlerRewardAttoEth - entryGasCost - lifecycleGasCost
}

/** Adjusts the quoted atto-WETH profit by the hedge's actual collateral difference, valued at the entry valuation. */
export function recoveredHedgedProfitBeforeGasWeth(direction: ArbitrageDirection, quotedProfitBeforeGas: bigint, quotedHedgeToken1: bigint, actualHedgeToken1: bigint, valuation: CollateralValuation) {
	const improvementToken1 = direction === 'sell-rep' ? actualHedgeToken1 - quotedHedgeToken1 : quotedHedgeToken1 - actualHedgeToken1
	return quotedProfitBeforeGas + attoWethValue(valuation, improvementToken1, 'down')
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

export function classifyPositionReport(position: Pick<PositionRecord, 'account' | 'reportAmount1' | 'reportAmount2' | 'reportDisputeIndex'>, game: Pick<OpenOracleGame, 'currentReporter' | 'currentAmount1' | 'currentAmount2' | 'numReports'>) {
	const sameReporter = position.account.toLowerCase() === game.currentReporter.toLowerCase()
	// A signer and repeated report amounts cannot prove a missing dispute cursor.
	if (position.reportDisputeIndex === undefined) return sameReporter ? 'unknown' : 'replaced'
	const positionReportCount = BigInt(position.reportDisputeIndex) + 1n
	if (positionReportCount < game.numReports) return 'replaced'
	if (game.numReports === (1n << 24n) - 1n || positionReportCount !== game.numReports || !sameReporter || position.reportAmount1 !== game.currentAmount1.toString() || position.reportAmount2 !== game.currentAmount2.toString()) return 'unknown'
	return 'current'
}
