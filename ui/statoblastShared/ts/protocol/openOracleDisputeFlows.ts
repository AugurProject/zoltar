import { OPEN_ORACLE_PERCENTAGE_PRECISION } from './openOracleValidation.js'

// Mirrors OpenOracle.dispute fee and contribution math; chargeFees is false before the halt when FLAG_FEES_ONLY_AT_HALT is set.
function getOpenOracleDisputeFees(oldAmount: bigint, { chargeFees, feePercentage, protocolFee }: { chargeFees: boolean; feePercentage: bigint; protocolFee: bigint }) {
	if (!chargeFees) return { fee: 0n, protocolFeeAmount: 0n }
	return { fee: (oldAmount * feePercentage) / OPEN_ORACLE_PERCENTAGE_PRECISION, protocolFeeAmount: (oldAmount * protocolFee) / OPEN_ORACLE_PERCENTAGE_PRECISION }
}
type OpenOracleDisputeContributionParameters = { chargeFees: boolean; feePercentage: bigint; isSelfDispute: boolean; newAmount1: bigint; newAmount2: bigint; oldAmount1: bigint; oldAmount2: bigint; protocolFee: bigint; tokenToSwap: 'token1' | 'token2' }
/** Token amounts the disputer pays, the fees inside them, and the quote tokens credited back to the disputer's oracle balance. */
export function resolveOpenOracleDisputeFlows({ chargeFees, feePercentage, isSelfDispute, newAmount1, newAmount2, oldAmount1, oldAmount2, protocolFee, tokenToSwap }: OpenOracleDisputeContributionParameters) {
	if (tokenToSwap === 'token1') {
		const { fee, protocolFeeAmount } = getOpenOracleDisputeFees(oldAmount1, { chargeFees, feePercentage, protocolFee })
		return {
			disputeFeeAmount: isSelfDispute ? 0n : fee,
			protocolFeeAmount,
			token1Contribution: isSelfDispute ? newAmount1 - oldAmount1 + protocolFeeAmount : newAmount1 + oldAmount1 + fee + protocolFeeAmount,
			token2Contribution: newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0n,
			token2Credit: newAmount2 < oldAmount2 ? oldAmount2 - newAmount2 : 0n,
		}
	}
	const { fee, protocolFeeAmount } = getOpenOracleDisputeFees(oldAmount2, { chargeFees, feePercentage, protocolFee })
	const token1Contribution = newAmount1 > oldAmount1 ? newAmount1 - oldAmount1 : 0n
	if (isSelfDispute) {
		const token2Needed = newAmount2 + protocolFeeAmount
		return {
			disputeFeeAmount: 0n,
			protocolFeeAmount,
			token1Contribution,
			token2Contribution: token2Needed >= oldAmount2 ? token2Needed - oldAmount2 : 0n,
			token2Credit: token2Needed < oldAmount2 ? oldAmount2 - token2Needed : 0n,
		}
	}
	return { disputeFeeAmount: fee, protocolFeeAmount, token1Contribution, token2Contribution: newAmount2 + oldAmount2 + fee + protocolFeeAmount, token2Credit: 0n }
}
