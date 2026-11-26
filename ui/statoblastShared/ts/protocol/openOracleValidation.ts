import { OPEN_ORACLE_MAX_UI_SETTLEMENT_SECONDS } from './openOracleSettlementSafety.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatDuration, formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatUnits, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import * as copy from '../copy/openOracle.js'

export const OPEN_ORACLE_PERCENTAGE_PRECISION = 10n ** 7n
export const OPEN_ORACLE_MULTIPLIER_PRECISION = 100n
const OPEN_ORACLE_UINT16_MAX = (1n << 16n) - 1n
const OPEN_ORACLE_UINT24_MAX = (1n << 24n) - 1n
const OPEN_ORACLE_UINT48_MAX = (1n << 48n) - 1n
const OPEN_ORACLE_UINT96_MAX = (1n << 96n) - 1n
const OPEN_ORACLE_UINT128_MAX = (1n << 128n) - 1n

type OpenOracleCreateValidationParameters = {
	disputeDelay: bigint
	escalationHalt: bigint
	exactToken1Report: bigint
	initialToken2Amount: bigint
	ethValueAttoEth: bigint
	feePercentage: bigint
	multiplier: bigint
	protocolFee: bigint
	settlementTime: bigint
	settlerRewardAttoEth: bigint
	token1Address: Address
	token2Address: Address
}

type OpenOracleCreateParameterValidation = {
	field: keyof OpenOracleCreateValidationParameters
	message: string | undefined
}

export function getOpenOracleCreateParameterValidation(
	{ disputeDelay, escalationHalt, exactToken1Report, initialToken2Amount, ethValueAttoEth, feePercentage, multiplier, protocolFee, settlementTime, settlerRewardAttoEth, token1Address, token2Address }: OpenOracleCreateValidationParameters,
	{ skipToken1MagnitudeValidation = false }: { skipToken1MagnitudeValidation?: boolean } = {},
): OpenOracleCreateParameterValidation | undefined {
	if (sameAddress(token1Address, token2Address)) return { field: 'token2Address', message: copy.differentReportTokens }
	if (sameAddress(token1Address, zeroAddress)) return { field: 'token1Address', message: copy.reportRequiresErc20Tokens }
	if (sameAddress(token2Address, zeroAddress)) return { field: 'token2Address', message: copy.reportRequiresErc20Tokens }
	if (exactToken1Report <= 0n) return { field: 'exactToken1Report', message: undefined }
	if (!skipToken1MagnitudeValidation && exactToken1Report > OPEN_ORACLE_UINT128_MAX) return { field: 'exactToken1Report', message: copy.baseTokenAmountTooLarge }
	if (initialToken2Amount <= 0n) return { field: 'initialToken2Amount', message: undefined }
	if (initialToken2Amount > OPEN_ORACLE_UINT128_MAX) return { field: 'initialToken2Amount', message: copy.quoteTokenAmountTooLarge }
	if (escalationHalt < 0n) return { field: 'escalationHalt', message: copy.disputeGrowthCutoffNegative }
	if (!skipToken1MagnitudeValidation && escalationHalt > OPEN_ORACLE_UINT128_MAX) return { field: 'escalationHalt', message: copy.disputeGrowthCutoffMaximum }
	if (settlerRewardAttoEth < 0n) return { field: 'settlerRewardAttoEth', message: copy.settlerRewardNegative }
	if (settlerRewardAttoEth > OPEN_ORACLE_UINT96_MAX) return { field: 'settlerRewardAttoEth', message: copy.settlerRewardTooLarge }
	if (ethValueAttoEth < 0n) return { field: 'ethValueAttoEth', message: copy.reportEthNegative }
	if (ethValueAttoEth > OPEN_ORACLE_UINT96_MAX) return { field: 'ethValueAttoEth', message: copy.reportEthTooLarge }
	if (ethValueAttoEth !== settlerRewardAttoEth) return { field: 'ethValueAttoEth', message: copy.reportEthMustEqualReward }
	if (settlementTime < 0n) return { field: 'settlementTime', message: copy.validSettlementDelayRequired }
	if (settlementTime > OPEN_ORACLE_UINT48_MAX) return { field: 'settlementTime', message: copy.settlementDelayTooLarge }
	if (settlementTime > OPEN_ORACLE_MAX_UI_SETTLEMENT_SECONDS) return { field: 'settlementTime', message: copy.settlementDurationLimit(formatDuration(OPEN_ORACLE_MAX_UI_SETTLEMENT_SECONDS)) }
	if (disputeDelay < 0n) return { field: 'disputeDelay', message: copy.validDisputeDelayRequired }
	if (disputeDelay > OPEN_ORACLE_UINT24_MAX) return { field: 'disputeDelay', message: copy.disputeDelayTooLarge }
	if (settlementTime <= disputeDelay) return { field: 'settlementTime', message: copy.settlementDelayMustExceedDisputeDelay }
	if (multiplier < OPEN_ORACLE_MULTIPLIER_PRECISION) return { field: 'multiplier', message: copy.multiplierTooSmall }
	if (multiplier > OPEN_ORACLE_UINT16_MAX) return { field: 'multiplier', message: copy.multiplierMaximum(formatMultiplier(OPEN_ORACLE_UINT16_MAX, 2)) }
	if (feePercentage < 0n) return { field: 'feePercentage', message: copy.disputeFeeNegative }
	if (feePercentage > OPEN_ORACLE_UINT24_MAX) return { field: 'feePercentage', message: copy.disputeFeeTooLarge }
	if (protocolFee < 0n) return { field: 'protocolFee', message: copy.protocolFeeNegative }
	if (protocolFee > OPEN_ORACLE_UINT24_MAX) return { field: 'protocolFee', message: copy.protocolFeeTooLarge }
	if (feePercentage + protocolFee > OPEN_ORACLE_PERCENTAGE_PRECISION) return { field: 'protocolFee', message: copy.reportFeeTotalMaximum(formatUnits(OPEN_ORACLE_PERCENTAGE_PRECISION, 5)) }
	return undefined
}
